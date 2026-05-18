/**
 * Google Opal API Client
 * 
 * Uses Google Drive API v3 + App Catalyst API directly via HTTP.
 * NO Playwright needed. Authentication via OAuth2 access token.
 * 
 * Discovery: Opal stores apps as Google Drive files with
 * mimeType = 'application/vnd.breadboard.graph+json'
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const OPAL_MIME = 'application/vnd.breadboard.graph+json';
const OPAL_BASE_URL = 'https://opal.google';

function getAuthDir(): string {
  const platform = os.platform();
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'opal-mcp');
  } else if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'opal-mcp');
  } else {
    return path.join(os.homedir(), '.config', 'opal-mcp');
  }
}

const AUTH_DIR = getAuthDir();
const TOKEN_FILE = path.join(AUTH_DIR, 'oauth-token.json');

export interface OpalApp {
  id: string;
  name: string;
  url: string;
  editUrl: string;
  modifiedTime?: string;
}

export interface OpalAppDetail extends OpalApp {
  nodes: any[];
  edges: any[];
  raw: any;
}

export interface GalleryApp {
  id: string;
  name: string;
  description: string;
  url: string;
}

interface TokenData {
  access_token: string;
  refresh_token?: string;
  expiry?: string;
}

export class OpalAPI {
  private accessToken: string = '';

  /**
   * Load saved token from disk
   */
  async init(): Promise<void> {
    if (!fs.existsSync(TOKEN_FILE)) {
      throw new Error('Not authenticated. Run "opal-mcp-auth" in your terminal first to sign in to Google.');
    }
    const data: TokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    this.accessToken = data.access_token;
  }

  /**
   * Check if authenticated and token is valid
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      await this.init();
      // Verify token by making a simple API call
      const resp = await fetch(`${DRIVE_API}/about?fields=user`, {
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Make authenticated API request
   */
  private async apiCall(url: string, options: RequestInit = {}): Promise<Response> {
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      }
    });
    if (resp.status === 401) {
      throw new Error('Token expired. Run "opal-mcp-auth" again to re-authenticate.');
    }
    return resp;
  }

  /**
   * List all user's Opal apps (from Google Drive)
   */
  async listApps(): Promise<OpalApp[]> {
    const query = `mimeType = '${OPAL_MIME}' and trashed = false and not properties has { key = 'isShareableCopy' and value = "true" } and 'me' in owners`;
    const fields = 'nextPageToken,files(id,name,modifiedTime,properties,appProperties)';
    
    const resp = await this.apiCall(
      `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&orderBy=modifiedTime+desc`
    );
    
    if (!resp.ok) {
      const error = await resp.text();
      throw new Error(`Failed to list apps: ${error}`);
    }

    const data = await resp.json();
    const files = data.files || [];

    return files.map((file: any) => ({
      id: file.id,
      name: file.name || 'Untitled Opal app',
      url: `${OPAL_BASE_URL}/app/${file.id}`,
      editUrl: `${OPAL_BASE_URL}/edit/${file.id}`,
      modifiedTime: file.modifiedTime
    }));
  }

  /**
   * Get app details (download the Breadboard JSON)
   */
  async getApp(appId: string): Promise<OpalAppDetail> {
    // Get metadata
    const metaResp = await this.apiCall(
      `${DRIVE_API}/files/${appId}?fields=id,name,modifiedTime,properties`
    );
    if (!metaResp.ok) throw new Error(`App not found: ${appId}`);
    const meta = await metaResp.json();

    // Download the Breadboard graph JSON
    const contentResp = await this.apiCall(
      `${DRIVE_API}/files/${appId}?alt=media`
    );
    if (!contentResp.ok) throw new Error(`Could not download app content: ${appId}`);
    const content = await contentResp.json();

    // Extract nodes and edges from Breadboard format
    const nodes = content.nodes || content.graphs?.main?.nodes || [];
    const edges = content.edges || content.graphs?.main?.edges || [];

    return {
      id: meta.id,
      name: meta.name || 'Untitled',
      url: `${OPAL_BASE_URL}/app/${appId}`,
      editUrl: `${OPAL_BASE_URL}/edit/${appId}`,
      modifiedTime: meta.modifiedTime,
      nodes,
      edges,
      raw: content
    };
  }

  /**
   * Create a new app
   * Note: This creates the file in Drive. The actual AI generation
   * happens through the Opal web UI, so we create a blank template.
   */
  async createApp(description: string): Promise<{ id: string; name: string }> {
    // Create a new Breadboard graph file in Drive
    const appName = description.slice(0, 80) || 'New Opal App';
    
    const fileMetadata = {
      name: appName,
      mimeType: OPAL_MIME,
      properties: {
        description: description
      }
    };

    // Create file with metadata
    const resp = await this.apiCall(`${DRIVE_API}/files`, {
      method: 'POST',
      body: JSON.stringify(fileMetadata)
    });

    if (!resp.ok) {
      const error = await resp.text();
      throw new Error(`Failed to create app: ${error}`);
    }

    const file = await resp.json();
    
    return {
      id: file.id,
      name: appName
    };
  }

  /**
   * Delete an app (move to trash in Drive)
   */
  async deleteApp(appId: string): Promise<boolean> {
    const resp = await this.apiCall(`${DRIVE_API}/files/${appId}`, {
      method: 'PATCH',
      body: JSON.stringify({ trashed: true })
    });
    return resp.ok;
  }

  /**
   * Run an app (sends input to the Opal app runner)
   * Note: This uses the App Catalyst API endpoint
   */
  async runApp(appId: string, input: string): Promise<string> {
    // First get the app content to understand its structure
    const app = await this.getApp(appId);
    
    // The run endpoint uses the app catalyst API
    // Try the standard Opal run endpoint
    try {
      const resp = await this.apiCall(
        `https://appcatalyst.pa.googleapis.com/v1beta1/projects/-/apps/${appId}:run`,
        {
          method: 'POST',
          body: JSON.stringify({ input: { text: input } })
        }
      );
      if (resp.ok) {
        const result = await resp.json();
        return JSON.stringify(result, null, 2);
      }
    } catch {
      // Fallback
    }

    return JSON.stringify({
      appId,
      name: app.name,
      input,
      message: 'Direct API run not available. Open the app in browser to run it.',
      url: app.url,
      nodes: app.nodes.length,
      edges: app.edges.length
    }, null, 2);
  }

  /**
   * List gallery/template apps
   * These are shared apps visible to all Opal users
   */
  async listGallery(): Promise<GalleryApp[]> {
    // Gallery apps are shared Opal apps not owned by the user
    const query = `mimeType = '${OPAL_MIME}' and trashed = false and properties has { key = 'isShareableCopy' and value = "true" }`;
    const fields = 'files(id,name,properties,appProperties)';
    
    try {
      const resp = await this.apiCall(
        `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&pageSize=20`
      );
      
      if (resp.ok) {
        const data = await resp.json();
        return (data.files || []).map((file: any) => ({
          id: file.id,
          name: file.name || 'Gallery App',
          description: file.properties?.description || file.appProperties?.description || '',
          url: `${OPAL_BASE_URL}/app/${file.id}`
        }));
      }
    } catch {
      // Gallery might use a different API
    }

    return [{
      id: 'gallery',
      name: 'Opal Gallery',
      description: 'Visit opal.google to browse gallery apps',
      url: `${OPAL_BASE_URL}/`
    }];
  }

  /**
   * Remix (copy) an app
   */
  async remixApp(appId: string): Promise<{ id: string; name: string }> {
    const resp = await this.apiCall(`${DRIVE_API}/files/${appId}/copy`, {
      method: 'POST',
      body: JSON.stringify({
        name: `Copy of app`
      })
    });

    if (!resp.ok) {
      throw new Error(`Failed to remix app: ${await resp.text()}`);
    }

    const file = await resp.json();
    return {
      id: file.id,
      name: file.name || 'Remixed App'
    };
  }

  async close(): Promise<void> {
    // Nothing to clean up (no browser)
  }
}
