# 🔮 Google Opal MCP Server

> Controlá [Google Opal](https://opal.google) directo desde tu asistente de IA (Antigravity, Claude Desktop, OpenCode, etc.).

Servidor MCP que expone 8 herramientas para crear, listar, ejecutar, clonar y eliminar mini-apps de **Google Opal** desde el chat.

## 🚀 Instalación en un comando

```bash
npx -y -p github:yamilonetto97-art/MCP-OPAL#v0.3.5 opal-mcp-install
```

Eso es todo. El instalador:

1. Instala el paquete globalmente (`opal-mcp-server`).
2. Registra la entrada `google-opal` en tu `mcp_config.json` de Antigravity (y Claude Desktop si está instalado) **sin pisar tus otros MCP servers**.
3. Abre una ventana de Chrome para que loguees con tu cuenta de Google **una sola vez**.
4. Captura el access token y lo guarda en disco.

Después reiniciá tu cliente MCP y probá: *"Lista mis apps de Google Opal"*.

> **Requisitos:** Node.js 18+ y Google Chrome instalado. El instalador NO descarga Chromium — usa el Chrome que ya tenés.

## 🤖 Prompt para tu asistente

Si querés que tu IA lo haga por vos, pegale esto:

```text
Instalá el MCP de Google Opal: corré `npx -y -p github:yamilonetto97-art/MCP-OPAL#v0.3.5 opal-mcp-install` y seguí lo que pida.
Cuando aparezca una ventana de Chrome, logueate con tu cuenta de Google.
Al terminar, reiniciá Antigravity.
```

## 🛠 Herramientas disponibles

| Tool | Descripción |
|------|-------------|
| `opal_check_auth` | Verifica el estado de autenticación |
| `opal_list_apps` | Lista todas tus apps de Opal |
| `opal_create_app` | Crea una app nueva desde una descripción |
| `opal_get_app` | Devuelve metadata + nodos + edges |
| `opal_run_app` | Ejecuta una app con un input |
| `opal_remix_app` | Clona una app de la galería |
| `opal_list_gallery` | Lista plantillas de la galería |
| `opal_delete_app` | Manda una app a la papelera |

## 🔐 Cómo funciona la auth

El token de acceso de Google expira cada ~1 h. Esta versión maneja la expiración **automáticamente**:

1. Cuando una request a Drive API da `401`, el server lanza Chrome **headless** con tu perfil cacheado.
2. Navega a `opal.google` y captura el token nuevo (no necesitás re-loguear porque las cookies persisten).
3. Reintenta la request original.

Vos no te enterás de que existían tokens. Si por alguna razón el refresh silencioso falla (Google forzó re-login, cookies expiraron, etc.), corré:

```bash
npx -y -p github:yamilonetto97-art/MCP-OPAL#v0.3.5 opal-mcp-install --refresh
```

y volvé a loguear en la ventana que aparece.

### Dónde se guardan las credenciales

| OS | Ruta |
|---|---|
| Windows | `%APPDATA%\opal-mcp\` |
| macOS | `~/Library/Application Support/opal-mcp/` |
| Linux | `~/.config/opal-mcp/` |

Adentro encontrás:
- `oauth-token.json` — el access token actual
- `chrome-profile/` — perfil persistente con tus cookies de Google (no lo compartas)

## 🩹 Solución de problemas

| Problema | Solución |
|---|---|
| `npm install -g` falla con EACCES | macOS/Linux: usá `sudo`. O configurá un prefix de npm propio en tu home. |
| `npm install -g` falla en Windows con execution policy | Ejecutá `cmd /c "npx -y -p github:yamilonetto97-art/MCP-OPAL#v0.3.5 opal-mcp-install"` desde PowerShell, o abrí una terminal `cmd` directamente. |
| Chrome no se abre | Verificá que tenés Google Chrome instalado (no Chromium ni Edge). Probá `google-chrome --version` (Linux) o abriendo Chrome a mano. |
| El MCP no aparece en Antigravity | Cerrá y abrí Antigravity. La config se cargó al inicio. |
| Token expirado y silent refresh no anduvo | `npx -y -p github:yamilonetto97-art/MCP-OPAL#v0.3.5 opal-mcp-install --refresh` |

## 🏗 Desarrollo

```bash
git clone https://github.com/yamilonetto97-art/MCP-OPAL.git
cd MCP-OPAL
npm install
npm run build
# probar el installer sin publicar
npm run install:cli
```

Estructura:
```
src/
├── index.ts                  # MCP server (8 tools)
├── install.ts                # opal-mcp-install CLI
├── api/opal-api.ts           # Drive API client + silent refresh
├── auth/
│   ├── capture-token.ts      # Playwright + persistent profile
│   └── login.ts              # OAuth2 loopback (fallback)
└── lib/paths.ts              # rutas + detección de clientes MCP
```

## ⚠️ Advertencias

- **Google Opal es experimental** — Google puede cambiar o cerrar el producto sin aviso.
- **Sin API pública** — Este server depende de la API interna de Google Drive + reverse-engineering del header de auth de Opal. Si Google cambia el flujo de auth, hay que adaptarlo.
- **El perfil de Chrome cacheado tiene tu sesión de Google.** Tratalo como una credencial: no lo subas a Git, no lo compartas.

## 📄 Licencia

MIT — Hecho por [EPIC Perú](https://generaapp.com) 🇵🇪
