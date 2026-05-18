/**
 * Google Opal Browser Controller
 * Uses Playwright to automate interactions with opal.google
 * Persists auth session via browser context storage
 * 
 * Cross-platform: Windows, macOS, Linux
 */
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const OPAL_BASE_URL = 'https://opal.google';

/**
 * Get cross-platform auth directory (same as login.ts)
 */
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
const STATE_FILE = path.join(AUTH_DIR, 'browser-state.json');

export class OpalBrowser {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  /**
   * Initialize browser with saved auth state (if exists)
   */
  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Load saved auth state if available
    const storageState = fs.existsSync(STATE_FILE) ? STATE_FILE : undefined;

    this.context = await this.browser.newContext({
      storageState,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 }
    });

    this.page = await this.context.newPage();
  }

  /**
   * Save current browser session state (cookies, localStorage)
   */
  async saveState(): Promise<void> {
    if (!this.context) return;
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
    await this.context.storageState({ path: STATE_FILE });
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/`, { waitUntil: 'networkidle' });
    
    // Check if we see "Your Opal apps" (means we're logged in)
    const loggedIn = await this.page.$('text=Your Opal apps');
    return !!loggedIn;
  }

  /**
   * List all user's Opal apps
   */
  async listApps(): Promise<OpalApp[]> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(2000);

    // Find all app cards in "Your Opal apps" section
    const apps: OpalApp[] = [];
    
    // Get app cards - each card has a title and description
    const appCards = await this.page.$$('[class*="app-card"], [class*="AppCard"], a[href*="/app/"], a[href*="/edit/"]');
    
    // Fallback: extract from DOM structure
    if (appCards.length === 0) {
      // Try to find app links by looking at the page content
      const links = await this.page.$$eval('a[href*="/edit/"], a[href*="/app/"]', (elements) => {
        return elements.map(el => ({
          href: el.getAttribute('href') || '',
          text: el.textContent?.trim() || ''
        }));
      });

      const seenIds = new Set<string>();
      for (const link of links) {
        const idMatch = link.href.match(/\/(edit|app)\/([^/]+)/);
        if (idMatch && !seenIds.has(idMatch[2])) {
          seenIds.add(idMatch[2]);
          apps.push({
            id: idMatch[2],
            name: link.text || 'Untitled',
            url: `${OPAL_BASE_URL}${link.href}`,
            editUrl: `${OPAL_BASE_URL}/edit/${idMatch[2]}`
          });
        }
      }
    }

    return apps;
  }

  /**
   * Get details of a specific app (nodes, connections)
   */
  async getApp(appId: string): Promise<OpalAppDetail> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/edit/${appId}`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(3000);

    // Extract app name
    const title = await this.page.textContent('[class*="title"], [class*="app-name"], h1, [class*="AppName"]') || 'Untitled';

    // Extract nodes from the visual editor canvas
    const nodes = await this.extractNodes();

    // Take a screenshot for debugging
    const screenshot = await this.page.screenshot({ type: 'png' });

    return {
      id: appId,
      name: title.trim(),
      url: `${OPAL_BASE_URL}/app/${appId}`,
      editUrl: `${OPAL_BASE_URL}/edit/${appId}`,
      nodes,
      screenshotBase64: screenshot.toString('base64')
    };
  }

  /**
   * Create a new app from a description
   */
  async createApp(description: string): Promise<{ id: string; name: string }> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(2000);

    // Click "Create New" button
    const createBtn = await this.page.$('text=Create New');
    if (!createBtn) throw new Error('Could not find Create New button');
    await createBtn.click();
    await this.page.waitForTimeout(2000);

    // Find and fill the description textarea
    const textarea = await this.page.$('textarea, [contenteditable="true"], input[type="text"]');
    if (textarea) {
      await textarea.fill(description);
      await this.page.waitForTimeout(1000);
    }

    // Look for generate/create/submit button
    const submitBtn = await this.page.$('button:has-text("Generate"), button:has-text("Create"), button:has-text("Build"), button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      // Try pressing Enter
      await this.page.keyboard.press('Enter');
    }

    // Wait for the editor to load
    await this.page.waitForTimeout(10000);
    await this.page.waitForLoadState('networkidle');

    // Extract the app ID from the URL
    const url = this.page.url();
    const idMatch = url.match(/\/(edit|app)\/([^/?]+)/);
    const id = idMatch ? idMatch[2] : 'unknown';

    // Get the app name
    const name = await this.page.textContent('[class*="title"], [class*="app-name"], h1') || description.slice(0, 50);

    await this.saveState();

    return { id, name: name.trim() };
  }

  /**
   * Run an app with given input
   */
  async runApp(appId: string, input: string): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/app/${appId}`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(3000);

    // Click Start button
    const startBtn = await this.page.$('button:has-text("Start"), [class*="start"]');
    if (startBtn) {
      await startBtn.click();
      await this.page.waitForTimeout(2000);
    }

    // Find input field and type
    const inputField = await this.page.$('textarea, input[type="text"], [contenteditable="true"]');
    if (inputField) {
      await inputField.fill(input);
      await this.page.waitForTimeout(500);
    }

    // Submit
    const submitBtn = await this.page.$('button:has-text("Submit"), button:has-text("Send"), button[type="submit"], button:has-text("Run")');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await this.page.keyboard.press('Enter');
    }

    // Wait for output
    await this.page.waitForTimeout(15000);

    // Extract output
    const output = await this.page.textContent('[class*="output"], [class*="result"], [class*="response"], main') || 'No output captured';
    
    return output.trim();
  }

  /**
   * Remix (clone) a gallery app
   */
  async remixApp(appId: string): Promise<{ id: string; name: string }> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/app/${appId}`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(2000);

    // Click Remix button
    const remixBtn = await this.page.$('button:has-text("Remix"), [class*="remix"]');
    if (!remixBtn) throw new Error('Could not find Remix button');
    await remixBtn.click();
    await this.page.waitForTimeout(5000);

    const url = this.page.url();
    const idMatch = url.match(/\/(edit|app)\/([^/?]+)/);
    const id = idMatch ? idMatch[2] : 'unknown';
    const name = await this.page.textContent('[class*="title"], h1') || 'Remixed App';

    await this.saveState();
    return { id, name: name.trim() };
  }

  /**
   * List gallery/template apps
   */
  async listGallery(): Promise<GalleryApp[]> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(2000);

    // Scroll to gallery section
    await this.page.evaluate(() => {
      const gallery = document.querySelector('[class*="gallery"], [class*="Gallery"]');
      if (gallery) gallery.scrollIntoView();
      else window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await this.page.waitForTimeout(1000);

    // Extract gallery app cards
    const gallery: GalleryApp[] = [];
    const cards = await this.page.$$eval('[class*="gallery"] a, [class*="Gallery"] a', (elements) => {
      return elements.map(el => ({
        href: el.getAttribute('href') || '',
        text: el.textContent?.trim() || ''
      }));
    });

    for (const card of cards) {
      const idMatch = card.href.match(/\/(app|edit)\/([^/?]+)/);
      if (idMatch) {
        gallery.push({
          id: idMatch[2],
          name: card.text.split('\n')[0] || 'Unknown',
          description: card.text,
          url: `${OPAL_BASE_URL}${card.href}`
        });
      }
    }

    return gallery;
  }

  /**
   * Delete an app
   */
  async deleteApp(appId: string): Promise<boolean> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(2000);

    // Find the app card and click the overflow menu (three dots)
    const appLink = await this.page.$(`a[href*="${appId}"]`);
    if (!appLink) throw new Error(`App ${appId} not found`);

    // Look for overflow/menu button near this app card
    const parent = await appLink.$('xpath=..');
    if (parent) {
      const menuBtn = await parent.$('[class*="more"], button[aria-label*="more"], [class*="overflow"]');
      if (menuBtn) {
        await menuBtn.click();
        await this.page.waitForTimeout(1000);

        const deleteBtn = await this.page.$('text=Delete, text=Remove');
        if (deleteBtn) {
          await deleteBtn.click();
          await this.page.waitForTimeout(1000);

          // Confirm deletion
          const confirmBtn = await this.page.$('button:has-text("Delete"), button:has-text("Confirm")');
          if (confirmBtn) await confirmBtn.click();
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Extract workflow nodes from the editor canvas
   */
  private async extractNodes(): Promise<OpalNode[]> {
    if (!this.page) return [];

    const nodes = await this.page.evaluate(() => {
      const nodeElements = document.querySelectorAll('[class*="node"], [class*="Node"], [class*="step"], [class*="Step"]');
      const result: any[] = [];

      nodeElements.forEach((el, index) => {
        const title = el.querySelector('[class*="title"], [class*="name"], [class*="header"], h3, h4')?.textContent?.trim();
        const content = el.querySelector('[class*="content"], [class*="body"], [class*="description"], p')?.textContent?.trim();
        const type = el.getAttribute('data-type') || el.getAttribute('data-node-type') || 'unknown';

        if (title || content) {
          result.push({
            index,
            title: title || `Node ${index}`,
            content: content || '',
            type,
            element: el.className
          });
        }
      });

      return result;
    });

    return nodes.map((n, i) => ({
      id: `node-${i}`,
      title: n.title,
      content: n.content,
      type: n.type,
      className: n.element
    }));
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    await this.saveState();
    if (this.browser) await this.browser.close();
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}

// --- Type Definitions ---

export interface OpalApp {
  id: string;
  name: string;
  url: string;
  editUrl: string;
}

export interface OpalAppDetail extends OpalApp {
  nodes: OpalNode[];
  screenshotBase64?: string;
}

export interface OpalNode {
  id: string;
  title: string;
  content: string;
  type: string;
  className?: string;
}

export interface GalleryApp {
  id: string;
  name: string;
  description: string;
  url: string;
}
