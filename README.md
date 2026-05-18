# 🔮 Google Opal MCP Server

> Control [Google Opal](https://opal.google) AI mini-apps directly from your AI assistant (Antigravity, Claude Desktop, OpenCode, etc.)

Google Opal is an experimental no-code AI platform from Google Labs that lets you create AI-powered mini-apps with natural language. This MCP server lets you **create, run, manage, and remix** Opal apps without opening a browser.

## ✨ What can you do?

| Tool | Description |
|------|-------------|
| `opal_list_apps` | List all your Opal apps |
| `opal_create_app` | Create a new app from a description |
| `opal_get_app` | Get app details and workflow nodes |
| `opal_run_app` | Execute an app with input |
| `opal_remix_app` | Clone a gallery template |
| `opal_list_gallery` | Browse available templates |
| `opal_delete_app` | Delete an app |
| `opal_check_auth` | Verify authentication status |

## 🚀 Quick Install

### Prerequisites
- **Node.js 18+** — [Download here](https://nodejs.org/)

### Step 1: Install the package

```bash
npm install -g opal-mcp-server
```

This will automatically download the Chromium browser needed for automation (~180MB, one-time only).

### Step 2: Authenticate

```bash
opal-mcp-auth
```

A Chrome window will open. Sign in with your Google account that has access to [opal.google](https://opal.google). The window closes automatically once you're logged in. **You only need to do this once.**

### Step 3: Add to your AI assistant

Add this to your MCP configuration file:

**Antigravity** (`~/.gemini/antigravity/mcp_config.json`):
```json
{
  "mcpServers": {
    "google-opal": {
      "command": "opal-mcp-server",
      "args": []
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "google-opal": {
      "command": "opal-mcp-server",
      "args": []
    }
  }
}
```

### Step 4: Use it!

Restart your AI assistant and try:
- *"List my Google Opal apps"*
- *"Create a new Opal app that summarizes articles"*
- *"Show me the Opal gallery templates"*
- *"Run my Opal app [ID] with input: Hello world"*

## 📋 Installation Prompt

Paste this prompt into your AI assistant to auto-install:

```
Instala y configura el servidor MCP de Google Opal por mí:
1. Verifica que Node.js 18+ esté instalado. Si no, indícame cómo instalarlo para mi sistema operativo.
2. Instala el paquete globalmente: npm install -g opal-mcp-server
3. Si el postinstall de Playwright falla, ejecuta: npx playwright install chromium
4. Ejecuta opal-mcp-auth y espera a que yo complete el inicio de sesión en el navegador.
5. Agrega la configuración del servidor MCP a mi archivo mcp_config.json con el comando "opal-mcp-server".
6. Verifica que funcione listando mis apps de Google Opal.
Guíame paso a paso y asegúrate de que todo funcione en mi sistema operativo.
```

## 🔐 How Authentication Works

1. `opal-mcp-auth` opens a real Chrome browser (visible)
2. You sign in to Google normally
3. Your session cookies are saved locally:
   - **Windows:** `%APPDATA%\opal-mcp\browser-state.json`
   - **macOS:** `~/Library/Application Support/opal-mcp/browser-state.json`
   - **Linux:** `~/.config/opal-mcp/browser-state.json`
4. The MCP server uses these cookies in headless (invisible) mode
5. If your session expires, just run `opal-mcp-auth` again

> ⚠️ **Security:** The `browser-state.json` file contains your Google session tokens. Never share it or commit it to version control.

## 🛠 Development

```bash
# Clone the repo
git clone https://github.com/yamilonetto97-art/MCP-OPAL.git
cd opal-mcp-server

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Build
npm run build

# Run auth
npm run auth

# Run server in dev mode
npm run dev
```

## ⚠️ Important Notes

- **Google Opal is experimental** — Google may change or remove it at any time
- **No official API** — This server automates the web interface using Playwright
- **Session may expire** — Re-run `opal-mcp-auth` if authentication fails
- **One session at a time** — Don't use Opal in your browser while the MCP is running

## 📄 License

MIT — Built by [EPIC Peru](https://github.com/epicperuofficial)
