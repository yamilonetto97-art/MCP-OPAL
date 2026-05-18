/**
 * Google Opal Browser Controller
 * Uses Playwright to automate interactions with opal.google
 * Persists auth session via browser context storage
 * 
 * Cross-platform: Windows, macOS, Linux
 * 
 * DOM Structure Reference (as of May 2026):
 * - Custom element: <bb-project-listing>
 * - App cards: div.board.mine
 * - App titles: h4 inside div.board
 * - Create button: #create-new-button-inline
 * - Overflow menu: button.overflow-menu
 * - Section header: div.section-header-text ("Your Opal apps")
 * - Grid container: div.grid
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
    
    // Real selector: div.section-header-text contains "Your Opal apps"
    const loggedIn = await this.page.$('div.section-header-text');
    if (loggedIn) {
      const text = await loggedIn.textContent();
      return text?.includes('Your Opal apps') || false;
    }
    // Fallback: check for the create button
    const createBtn = await this.page.$('#create-new-button-inline');
    return !!createBtn;
  }

  /**
   * List all user's Opal apps
   * Real DOM: div.board.mine contains h4 (title) and p (description)
   * Apps are loaded inside <bb-project-listing> > div.grid
   */
  async listApps(): Promise<OpalApp[]> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(3000);

    // Real selector: each app card is div.board.mine
    const apps = await this.page.$$eval('div.board.mine', (cards) => {
      return cards.map((card, index) => {
        const title = card.querySelector('h4')?.textContent?.trim() || `App ${index + 1}`;
        const description = card.querySelector('p')?.textContent?.trim() || '';
        
        // Try to get app ID from click handler or data attributes
        const clickTarget = card.getAttribute('data-id') || 
                           card.getAttribute('data-board-id') || '';
        
        return { title, description, clickTarget, index };
      });
    });

    // We need to get the actual app IDs by clicking each card and reading the URL
    const result: OpalApp[] = [];
    
    for (const app of apps) {
      // Click the card to navigate to it
      const cards = await this.page.$$('div.board.mine');
      if (cards[app.index]) {
        const h4 = await cards[app.index].$('h4');
        if (h4) {
          await h4.click();
          await this.page.waitForTimeout(2000);
          await this.page.waitForLoadState('networkidle');
          
          const url = this.page.url();
          const idMatch = url.match(/\/(edit|app)\/([^/?#]+)/);
          const id = idMatch ? idMatch[2] : `unknown-${app.index}`;
          
          result.push({
            id,
            name: app.title,
            url: `${OPAL_BASE_URL}/app/${id}`,
            editUrl: `${OPAL_BASE_URL}/edit/${id}`
          });
          
          // Go back to the listing
          await this.page.goto(`${OPAL_BASE_URL}/`, { waitUntil: 'networkidle' });
          await this.page.waitForTimeout(2000);
        }
      }
    }

    return result;
  }

  /**
   * Get details of a specific app (nodes, connections)
   */
  async getApp(appId: string): Promise<OpalAppDetail> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/edit/${appId}`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(5000);

    // Extract app name from the page
    const title = await this.page.evaluate(() => {
      // Try multiple selectors for the app title in the editor
      const selectors = ['h1', 'h2', 'h3', 'h4', '[class*="title"]', '[class*="name"]'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent?.trim()) return el.textContent.trim();
      }
      return 'Untitled';
    });

    // Extract nodes from the visual editor canvas
    const nodes = await this.extractNodes();

    // Take a screenshot
    const screenshot = await this.page.screenshot({ type: 'png' });

    return {
      id: appId,
      name: title,
      url: `${OPAL_BASE_URL}/app/${appId}`,
      editUrl: `${OPAL_BASE_URL}/edit/${appId}`,
      nodes,
      screenshotBase64: screenshot.toString('base64')
    };
  }

  /**
   * Create a new app from a description
   * Real DOM: #create-new-button-inline triggers creation flow
   */
  async createApp(description: string): Promise<{ id: string; name: string }> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(2000);

    // Click "Create New" button - real selector from DOM
    const createBtn = await this.page.$('#create-new-button-inline');
    if (!createBtn) throw new Error('Could not find Create New button (expected #create-new-button-inline)');
    await createBtn.click();
    await this.page.waitForTimeout(3000);

    // Find and fill the description textarea/input
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

    // Wait for the editor to load (app generation takes time)
    await this.page.waitForTimeout(15000);
    await this.page.waitForLoadState('networkidle');

    // Extract the app ID from the URL
    const url = this.page.url();
    const idMatch = url.match(/\/(edit|app)\/([^/?#]+)/);
    const id = idMatch ? idMatch[2] : 'unknown';

    // Get the app name
    const name = await this.page.evaluate(() => {
      const h = document.querySelector('h1, h2, h3, h4');
      return h?.textContent?.trim() || '';
    }) || description.slice(0, 50);

    await this.saveState();

    return { id, name: name.trim() };
  }

  /**
   * Run an app with given input
   */
  async runApp(appId: string, input: string): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/app/${appId}`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(5000);

    // Find input field and type
    const inputField = await this.page.$('textarea, input[type="text"], [contenteditable="true"]');
    if (inputField) {
      await inputField.fill(input);
      await this.page.waitForTimeout(500);
    }

    // Submit - look for various submit buttons
    const submitBtn = await this.page.$('button:has-text("Submit"), button:has-text("Send"), button[type="submit"], button:has-text("Run"), button:has-text("Go")');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await this.page.keyboard.press('Enter');
    }

    // Wait for output (AI processing takes time)
    await this.page.waitForTimeout(20000);

    // Extract all visible text as output
    const output = await this.page.evaluate(() => {
      // Try to find output/result containers
      const selectors = [
        '[class*="output"]', '[class*="result"]', '[class*="response"]',
        '[class*="answer"]', '[class*="content"]', 'main'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent?.trim()) return el.textContent.trim();
      }
      return document.body.innerText;
    });
    
    return output || 'No output captured';
  }

  /**
   * Remix (clone) a gallery app
   */
  async remixApp(appId: string): Promise<{ id: string; name: string }> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/app/${appId}`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(3000);

    // Click Remix button
    const remixBtn = await this.page.$('button:has-text("Remix"), button:has-text("remix"), [class*="remix"]');
    if (!remixBtn) throw new Error('Could not find Remix button');
    await remixBtn.click();
    await this.page.waitForTimeout(5000);
    await this.page.waitForLoadState('networkidle');

    const url = this.page.url();
    const idMatch = url.match(/\/(edit|app)\/([^/?#]+)/);
    const id = idMatch ? idMatch[2] : 'unknown';
    const name = await this.page.evaluate(() => {
      const h = document.querySelector('h1, h2, h3, h4');
      return h?.textContent?.trim() || 'Remixed App';
    });

    await this.saveState();
    return { id, name };
  }

  /**
   * List gallery/template apps
   * The gallery section is below the user apps on the main page
   */
  async listGallery(): Promise<GalleryApp[]> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(`${OPAL_BASE_URL}/`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(3000);

    // Scroll down to load gallery apps
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.page.waitForTimeout(2000);

    // Gallery apps are div.board but NOT .mine
    const gallery = await this.page.$$eval('div.board:not(.mine)', (cards) => {
      return cards.map((card) => {
        const title = card.querySelector('h4')?.textContent?.trim() || 'Unknown';
        const description = card.querySelector('p')?.textContent?.trim() || '';
        return { title, description };
      });
    });

    // If no non-.mine boards found, try all boards after the "Your Opal apps" section
    if (gallery.length === 0) {
      const allText = await this.page.evaluate(() => {
        const sections = document.querySelectorAll('.listing-section');
        const result: any[] = [];
        sections.forEach((section, i) => {
          if (i === 0) return; // Skip "Your Opal apps"
          const cards = section.querySelectorAll('div.board, [class*="board"]');
          cards.forEach(card => {
            result.push({
              title: card.querySelector('h4')?.textContent?.trim() || 'Unknown',
              description: card.querySelector('p')?.textContent?.trim() || ''
            });
          });
        });
        return result;
      });
      return allText.map((item: any, i: number) => ({
        id: `gallery-${i}`,
        name: item.title,
        description: item.description,
        url: `${OPAL_BASE_URL}/`
      }));
    }

    return gallery.map((item, i) => ({
      id: `gallery-${i}`,
      name: item.title,
      description: item.description,
      url: `${OPAL_BASE_URL}/`
    }));
  }

  /**
   * Delete an app using the overflow menu
   * Real DOM: button.overflow-menu shows a dropdown with Delete option
   */
  async deleteApp(appId: string): Promise<boolean> {
    if (!this.page) throw new Error('Browser not initialized');
    
    // First list apps to find the right card
    await this.page.goto(`${OPAL_BASE_URL}/`, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(2000);

    // Get all cards and click each to find the one matching appId
    const cards = await this.page.$$('div.board.mine');
    
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      
      // Click the overflow menu (three dots) - button.overflow-menu
      const menuBtn = await card.$('button.overflow-menu');
      if (menuBtn) {
        await menuBtn.click();
        await this.page.waitForTimeout(1000);

        // Look for Delete option in the dropdown
        const deleteBtn = await this.page.$('button:has-text("Delete"), [class*="delete"], text=Delete');
        if (deleteBtn) {
          await deleteBtn.click();
          await this.page.waitForTimeout(1000);

          // Confirm deletion dialog
          const confirmBtn = await this.page.$('button:has-text("Delete"), button:has-text("Confirm"), button:has-text("Yes")');
          if (confirmBtn) {
            await confirmBtn.click();
            await this.page.waitForTimeout(2000);
            return true;
          }
        }
        
        // Close menu if we didn't delete (wrong card)
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
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
      // Try multiple selector strategies for the editor nodes
      const selectors = [
        '[class*="node"]', '[class*="Node"]',
        '[class*="step"]', '[class*="Step"]',
        '[class*="block"]', '[class*="Block"]',
        '[class*="card"]'
      ];
      
      const result: any[] = [];
      const seen = new Set<string>();

      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        elements.forEach((el, index) => {
          const title = el.querySelector('h3, h4, [class*="title"], [class*="name"], [class*="header"]')?.textContent?.trim();
          const content = el.querySelector('p, [class*="content"], [class*="body"], [class*="description"], textarea')?.textContent?.trim();
          
          const key = `${title}-${content}`;
          if ((title || content) && !seen.has(key)) {
            seen.add(key);
            result.push({
              index: result.length,
              title: title || `Node ${result.length}`,
              content: content || '',
              type: el.getAttribute('data-type') || el.getAttribute('data-node-type') || el.className?.split(' ')[0] || 'unknown',
              element: el.className
            });
          }
        });
      }

      return result;
    });

    return nodes.map((n: any, i: number) => ({
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
