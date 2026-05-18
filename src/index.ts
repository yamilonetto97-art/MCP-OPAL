#!/usr/bin/env node
/**
 * Google Opal MCP Server
 * 
 * Exposes Google Opal (opal.google) as MCP tools.
 * Uses Google Drive API + OAuth2 (no Playwright, no browser automation).
 * 
 * Tools:
 * - opal_check_auth: Verify authentication status
 * - opal_list_apps: List user's Opal mini-apps
 * - opal_create_app: Create a new app
 * - opal_get_app: Get app details (nodes, edges)
 * - opal_run_app: Run an app with input
 * - opal_remix_app: Clone/remix a gallery app
 * - opal_list_gallery: List gallery templates
 * - opal_delete_app: Delete an app
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { OpalAPI } from './api/opal-api.js';

const server = new McpServer({
  name: 'google-opal',
  version: '0.3.3',
});

// --- Tool: Check Authentication ---
server.tool(
  'opal_check_auth',
  'Check if the Google Opal MCP server is authenticated',
  {},
  async () => {
    const api = new OpalAPI();
    try {
      const isAuth = await api.isAuthenticated();
      if (isAuth) {
        return { content: [{ type: 'text', text: '✅ Authenticated. Google Opal MCP is ready to use.' }] };
      } else {
        return { content: [{ type: 'text', text: '❌ Token expired. Run "npx -y -p github:yamilonetto97-art/MCP-OPAL#v0.3.3 opal-mcp-install --refresh" in your terminal to re-authenticate.' }] };
      }
    } catch (error: any) {
      return { content: [{ type: 'text', text: `❌ Not authenticated. Run "npx -y -p github:yamilonetto97-art/MCP-OPAL#v0.3.3 opal-mcp-install --refresh" in your terminal first to sign in to Google.` }] };
    }
  }
);

// --- Tool: List Apps ---
server.tool(
  'opal_list_apps',
  'List all your Google Opal mini-apps',
  {},
  async () => {
    const api = new OpalAPI();
    try {
      await api.init();
      const apps = await api.listApps();
      if (apps.length === 0) {
        return { content: [{ type: 'text', text: 'No Opal apps found. Create one with opal_create_app.' }] };
      }
      const text = apps.map((app, i) => 
        `${i + 1}. **${app.name}**\n   ID: ${app.id}\n   Edit: ${app.editUrl}\n   Modified: ${app.modifiedTime || 'unknown'}`
      ).join('\n\n');
      return { content: [{ type: 'text', text: `Found ${apps.length} Opal apps:\n\n${text}` }] };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    }
  }
);

// --- Tool: Create App ---
server.tool(
  'opal_create_app',
  'Create a new Google Opal AI mini-app from a natural language description',
  { description: z.string().describe('Description of the app to create (in natural language)') },
  async ({ description }) => {
    const api = new OpalAPI();
    try {
      await api.init();
      const result = await api.createApp(description);
      return { content: [{ type: 'text', text: `✅ App created!\n\nName: ${result.name}\nID: ${result.id}\nEdit URL: https://opal.google/edit/${result.id}\n\nNote: Open the edit URL in your browser to use the AI builder to customize the app.` }] };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error creating app: ${error.message}` }] };
    }
  }
);

// --- Tool: Get App Details ---
server.tool(
  'opal_get_app',
  'Get details of a specific Opal app including its workflow nodes and connections',
  { appId: z.string().describe('The Opal app ID (from the URL)') },
  async ({ appId }) => {
    const api = new OpalAPI();
    try {
      await api.init();
      const app = await api.getApp(appId);
      const text = [
        `**${app.name}**`,
        `ID: ${app.id}`,
        `Edit: ${app.editUrl}`,
        `Run: ${app.url}`,
        `Modified: ${app.modifiedTime || 'unknown'}`,
        `Nodes: ${app.nodes.length}`,
        `Edges: ${app.edges.length}`,
        '',
        '**Nodes:**',
        JSON.stringify(app.nodes, null, 2),
        '',
        '**Edges:**',
        JSON.stringify(app.edges, null, 2),
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    }
  }
);

// --- Tool: Run App ---
server.tool(
  'opal_run_app',
  'Run/execute a Google Opal app with given input and get the output',
  {
    appId: z.string().describe('The Opal app ID'),
    input: z.string().describe('The input text to provide to the app'),
  },
  async ({ appId, input }) => {
    const api = new OpalAPI();
    try {
      await api.init();
      const result = await api.runApp(appId, input);
      return { content: [{ type: 'text', text: result }] };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error running app: ${error.message}` }] };
    }
  }
);

// --- Tool: Remix App ---
server.tool(
  'opal_remix_app',
  'Remix (clone) a Google Opal gallery template into your own apps',
  { appId: z.string().describe('The gallery app ID to remix/clone') },
  async ({ appId }) => {
    const api = new OpalAPI();
    try {
      await api.init();
      const result = await api.remixApp(appId);
      return { content: [{ type: 'text', text: `✅ App remixed!\n\nName: ${result.name}\nID: ${result.id}\nEdit: https://opal.google/edit/${result.id}` }] };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error remixing app: ${error.message}` }] };
    }
  }
);

// --- Tool: List Gallery ---
server.tool(
  'opal_list_gallery',
  'List available template apps from the Google Opal gallery',
  {},
  async () => {
    const api = new OpalAPI();
    try {
      await api.init();
      const gallery = await api.listGallery();
      const text = gallery.map((app, i) =>
        `${i + 1}. **${app.name}**\n   ID: ${app.id}\n   ${app.description}\n   URL: ${app.url}`
      ).join('\n\n');
      return { content: [{ type: 'text', text: `Gallery apps:\n\n${text}` }] };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    }
  }
);

// --- Tool: Delete App ---
server.tool(
  'opal_delete_app',
  'Delete one of your Google Opal apps',
  { appId: z.string().describe('The Opal app ID to delete') },
  async ({ appId }) => {
    const api = new OpalAPI();
    try {
      await api.init();
      const success = await api.deleteApp(appId);
      if (success) {
        return { content: [{ type: 'text', text: `✅ App ${appId} moved to trash.` }] };
      }
      return { content: [{ type: 'text', text: `❌ Could not delete app ${appId}.` }] };
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    }
  }
);

// --- Start Server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
