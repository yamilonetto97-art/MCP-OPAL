#!/usr/bin/env node
/**
 * Google Opal MCP Server
 * 
 * Exposes Google Opal (opal.google) as MCP tools via Playwright browser automation.
 * Tools: list_apps, create_app, get_app, run_app, remix_app, list_gallery, delete_app
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { OpalBrowser } from './browser/opal-browser.js';

const server = new McpServer({
  name: 'google-opal',
  version: '0.1.0'
});

let browser: OpalBrowser | null = null;

/**
 * Ensure browser is initialized and authenticated
 */
async function ensureBrowser(): Promise<OpalBrowser> {
  if (!browser) {
    browser = new OpalBrowser();
    await browser.init();

    const authenticated = await browser.isAuthenticated();
    if (!authenticated) {
      throw new Error(
        'Not authenticated. Run "opal-mcp-auth" in your terminal first to sign in to Google.'
      );
    }
  }
  return browser;
}

// ============================================================
// TOOL: opal_list_apps
// ============================================================
server.tool(
  'opal_list_apps',
  'List all your Google Opal apps',
  {},
  async () => {
    try {
      const b = await ensureBrowser();
      const apps = await b.listApps();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: apps.length,
            apps: apps.map(a => ({
              id: a.id,
              name: a.name,
              url: a.url,
              editUrl: a.editUrl
            }))
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  }
);

// ============================================================
// TOOL: opal_create_app
// ============================================================
server.tool(
  'opal_create_app',
  'Create a new Google Opal AI mini-app from a natural language description',
  {
    description: z.string().describe('Description of the app to create (in natural language)')
  },
  async ({ description }) => {
    try {
      const b = await ensureBrowser();
      const result = await b.createApp(description);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            app: {
              id: result.id,
              name: result.name,
              editUrl: `https://opal.google/edit/${result.id}`,
              appUrl: `https://opal.google/app/${result.id}`
            }
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error creating app: ${error.message}` }], isError: true };
    }
  }
);

// ============================================================
// TOOL: opal_get_app
// ============================================================
server.tool(
  'opal_get_app',
  'Get details of a specific Opal app including its workflow nodes and connections',
  {
    appId: z.string().describe('The Opal app ID (from the URL)')
  },
  async ({ appId }) => {
    try {
      const b = await ensureBrowser();
      const app = await b.getApp(appId);

      const response: any = {
        id: app.id,
        name: app.name,
        url: app.url,
        editUrl: app.editUrl,
        nodes: app.nodes
      };

      const content: any[] = [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }];

      // Include screenshot if available
      if (app.screenshotBase64) {
        content.push({
          type: 'image',
          data: app.screenshotBase64,
          mimeType: 'image/png'
        });
      }

      return { content };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  }
);

// ============================================================
// TOOL: opal_run_app
// ============================================================
server.tool(
  'opal_run_app',
  'Run/execute a Google Opal app with given input and get the output',
  {
    appId: z.string().describe('The Opal app ID'),
    input: z.string().describe('The input text to provide to the app')
  },
  async ({ appId, input }) => {
    try {
      const b = await ensureBrowser();
      const output = await b.runApp(appId, input);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            appId,
            input,
            output
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error running app: ${error.message}` }], isError: true };
    }
  }
);

// ============================================================
// TOOL: opal_remix_app
// ============================================================
server.tool(
  'opal_remix_app',
  'Remix (clone) a Google Opal gallery template into your own apps',
  {
    appId: z.string().describe('The gallery app ID to remix/clone')
  },
  async ({ appId }) => {
    try {
      const b = await ensureBrowser();
      const result = await b.remixApp(appId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            originalAppId: appId,
            newApp: {
              id: result.id,
              name: result.name,
              editUrl: `https://opal.google/edit/${result.id}`,
              appUrl: `https://opal.google/app/${result.id}`
            }
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error remixing app: ${error.message}` }], isError: true };
    }
  }
);

// ============================================================
// TOOL: opal_list_gallery
// ============================================================
server.tool(
  'opal_list_gallery',
  'List available template apps from the Google Opal gallery',
  {},
  async () => {
    try {
      const b = await ensureBrowser();
      const gallery = await b.listGallery();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: gallery.length,
            templates: gallery
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  }
);

// ============================================================
// TOOL: opal_delete_app
// ============================================================
server.tool(
  'opal_delete_app',
  'Delete one of your Google Opal apps',
  {
    appId: z.string().describe('The Opal app ID to delete')
  },
  async ({ appId }) => {
    try {
      const b = await ensureBrowser();
      const success = await b.deleteApp(appId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success,
            appId,
            message: success ? 'App deleted successfully' : 'Could not delete app - menu items not found'
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error deleting app: ${error.message}` }], isError: true };
    }
  }
);

// ============================================================
// TOOL: opal_check_auth
// ============================================================
server.tool(
  'opal_check_auth',
  'Check if the Google Opal MCP server is authenticated',
  {},
  async () => {
    try {
      const b = await ensureBrowser();
      const authenticated = await b.isAuthenticated();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            authenticated,
            message: authenticated
              ? 'Authenticated and ready to use Google Opal'
              : 'Not authenticated. Run opal-mcp-auth to sign in.'
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  }
);

// ============================================================
// Server lifecycle
// ============================================================
async function main() {
  const transport = new StdioServerTransport();
  
  // Cleanup on exit
  process.on('SIGINT', async () => {
    if (browser) await browser.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    if (browser) await browser.close();
    process.exit(0);
  });

  await server.connect(transport);
  console.error('[opal-mcp] Server started on stdio');
}

main().catch((error) => {
  console.error('[opal-mcp] Fatal error:', error);
  process.exit(1);
});
