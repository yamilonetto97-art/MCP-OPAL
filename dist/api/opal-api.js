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
function getAuthDir() {
    const platform = os.platform();
    if (platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'opal-mcp');
    }
    else if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'opal-mcp');
    }
    else {
        return path.join(os.homedir(), '.config', 'opal-mcp');
    }
}
const AUTH_DIR = getAuthDir();
const TOKEN_FILE = path.join(AUTH_DIR, 'oauth-token.json');
const CHROME_PROFILE_DIR = path.join(AUTH_DIR, 'chrome-profile');
/**
 * Best-effort silent re-capture of the access token using a cached Chrome
 * profile that was set up by `opal-mcp-install`. Returns the new token
 * (also persisting it to TOKEN_FILE) or null if the profile is missing
 * or playwright-core is not available.
 */
async function trySilentTokenRefresh() {
    if (!fs.existsSync(CHROME_PROFILE_DIR))
        return null;
    try {
        // Dynamic import keeps playwright out of the cold-start path of the MCP server.
        const mod = await import('../auth/capture-token.js');
        const { accessToken } = await mod.captureToken({ silent: true, timeoutMs: 45_000 });
        return accessToken || null;
    }
    catch (err) {
        console.error('[opal-mcp] silent refresh failed:', err?.message || err);
        return null;
    }
}
export class OpalAPI {
    accessToken = '';
    /**
     * Load saved token from disk
     */
    async init() {
        if (!fs.existsSync(TOKEN_FILE)) {
            throw new Error('Not authenticated. Run "opal-mcp-auth" in your terminal first to sign in to Google.');
        }
        const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
        this.accessToken = data.access_token;
    }
    /**
     * Check if authenticated and token is valid
     */
    async isAuthenticated() {
        try {
            await this.init();
            // Verify token by making a simple API call
            const resp = await fetch(`${DRIVE_API}/about?fields=user`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            return resp.ok;
        }
        catch {
            return false;
        }
    }
    async apiCall(url, options = {}) {
        let resp = await fetch(url, {
            ...options,
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json',
                ...options.headers,
            }
        });
        // Auto-refresh token if 401 Unauthorized
        if (resp.status === 401) {
            const refreshed = await this.refreshAccessToken();
            if (!refreshed) {
                throw new Error('Token expirado y no se pudo renovar automáticamente. ' +
                    'Corré: npx -y -p github:yamilonetto97-art/MCP-OPAL#v0.3.4 opal-mcp-install --refresh');
            }
            // Retry the original request with the new token.
            resp = await fetch(url, {
                ...options,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    ...options.headers,
                }
            });
            if (resp.status === 401) {
                throw new Error('Token sigue inválido después de renovar. ' +
                    'Corré: npx -y -p github:yamilonetto97-art/MCP-OPAL#v0.3.4 opal-mcp-install --refresh (modo interactivo)');
            }
        }
        return resp;
    }
    /**
     * Renueva el access token. Estrategia:
     *   1. Si existe refresh_token (OAuth flow clásico), usa el endpoint oficial.
     *   2. Si no, intenta una recaptura silenciosa con el perfil de Chrome cacheado
     *      (el que dejó `opal-mcp-install`).
     * Devuelve true si quedó renovado en memoria + disco; false si no pudo.
     */
    async refreshAccessToken() {
        let data = {};
        if (fs.existsSync(TOKEN_FILE)) {
            try {
                data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
            }
            catch { /* ignore — treat as missing */ }
        }
        if (data.refresh_token) {
            console.error('[opal-mcp] refrescando con refresh_token…');
            try {
                const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com',
                        refresh_token: data.refresh_token,
                        grant_type: 'refresh_token',
                    }).toString(),
                });
                if (tokenResp.ok) {
                    const tokens = await tokenResp.json();
                    this.accessToken = tokens.access_token;
                    data.access_token = tokens.access_token;
                    if (tokens.refresh_token)
                        data.refresh_token = tokens.refresh_token;
                    data.expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
                    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
                    return true;
                }
            }
            catch (err) {
                console.error('[opal-mcp] refresh_token falló:', err?.message || err);
            }
        }
        // Fallback: silent recapture using the cached Chrome profile.
        console.error('[opal-mcp] intentando recaptura silenciosa con perfil cacheado…');
        const newToken = await trySilentTokenRefresh();
        if (newToken) {
            this.accessToken = newToken;
            return true;
        }
        return false;
    }
    /**
     * List all user's Opal apps (from Google Drive)
     */
    async listApps() {
        const query = `mimeType = '${OPAL_MIME}' and trashed = false and not properties has { key = 'isShareableCopy' and value = "true" } and 'me' in owners`;
        const fields = 'nextPageToken,files(id,name,modifiedTime,properties,appProperties)';
        const resp = await this.apiCall(`${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&orderBy=modifiedTime+desc`);
        if (!resp.ok) {
            const error = await resp.text();
            throw new Error(`Failed to list apps: ${error}`);
        }
        const data = await resp.json();
        const files = data.files || [];
        return files.map((file) => ({
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
    async getApp(appId) {
        // Get metadata
        const metaResp = await this.apiCall(`${DRIVE_API}/files/${appId}?fields=id,name,modifiedTime,properties`);
        if (!metaResp.ok)
            throw new Error(`App not found: ${appId}`);
        const meta = await metaResp.json();
        // Download the Breadboard graph JSON
        const contentResp = await this.apiCall(`${DRIVE_API}/files/${appId}?alt=media`);
        if (!contentResp.ok)
            throw new Error(`Could not download app content: ${appId}`);
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
    async createApp(description) {
        // Create a new Breadboard graph file in Drive
        const appName = description.slice(0, 80) || 'New Opal App';
        const fileMetadata = {
            name: appName,
            mimeType: OPAL_MIME,
            properties: {
                description: description.substring(0, 100)
            }
        };
        // Create file with metadata
        const resp = await this.apiCall(`${DRIVE_API}/files`, {
            method: 'POST',
            body: JSON.stringify(fileMetadata)
        });
        if (!resp.ok) {
            const error = await resp.text();
            throw new Error(`Failed to create app metadata: ${error}`);
        }
        const file = await resp.json();
        // Upload initial empty template so it doesn't get stuck loading in UI
        const initialContent = {
            title: appName,
            description: description,
            version: "0.0.1",
            nodes: [],
            edges: [],
            metadata: {
                intent: description
            }
        };
        await this.apiCall(`https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=media`, {
            method: 'PATCH',
            body: JSON.stringify(initialContent)
        });
        return {
            id: file.id,
            name: appName
        };
    }
    /**
     * Delete an app (move to trash in Drive)
     */
    async deleteApp(appId) {
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
    async runApp(appId, input) {
        // First get the app content to understand its structure
        const app = await this.getApp(appId);
        // The run endpoint uses the app catalyst API
        // Try the standard Opal run endpoint
        try {
            const resp = await this.apiCall(`https://appcatalyst.pa.googleapis.com/v1beta1/projects/-/apps/${appId}:run`, {
                method: 'POST',
                body: JSON.stringify({ input: { text: input } })
            });
            if (resp.ok) {
                const result = await resp.json();
                return JSON.stringify(result, null, 2);
            }
        }
        catch {
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
    async listGallery() {
        // Gallery apps are shared Opal apps not owned by the user
        const query = `mimeType = '${OPAL_MIME}' and trashed = false and properties has { key = 'isShareableCopy' and value = "true" }`;
        const fields = 'files(id,name,properties,appProperties)';
        try {
            const resp = await this.apiCall(`${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&pageSize=20`);
            if (resp.ok) {
                const data = await resp.json();
                return (data.files || []).map((file) => ({
                    id: file.id,
                    name: file.name || 'Gallery App',
                    description: file.properties?.description || file.appProperties?.description || '',
                    url: `${OPAL_BASE_URL}/app/${file.id}`
                }));
            }
        }
        catch {
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
    async remixApp(appId) {
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
    async close() {
        // Nothing to clean up (no browser)
    }
}
//# sourceMappingURL=opal-api.js.map