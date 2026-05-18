import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { chromium, type BrowserContext } from 'playwright-core';
import { AUTH_DIR, CHROME_PROFILE_DIR, TOKEN_FILE, ensureDir } from '../lib/paths.js';

const OPAL_URL = 'https://opal.google';
const CAPTURE_TIMEOUT_MS = 90_000;

const HOOK_SCRIPT = `
(() => {
  if (window.__OPAL_TOKEN__) return;
  window.__OPAL_TOKEN__ = null;
  const captureFromAuthHeader = (value) => {
    if (typeof value !== 'string') return;
    if (value.startsWith('Bearer ya29.')) {
      window.__OPAL_TOKEN__ = value.slice(7);
    }
  };
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      const headers = (init && init.headers) || (input && input.headers);
      if (headers) {
        if (typeof headers.get === 'function') {
          captureFromAuthHeader(headers.get('authorization'));
        } else if (Array.isArray(headers)) {
          for (const [k, v] of headers) {
            if (String(k).toLowerCase() === 'authorization') captureFromAuthHeader(v);
          }
        } else {
          captureFromAuthHeader(headers.Authorization || headers.authorization);
        }
      }
    } catch (e) { /* ignore */ }
    return _fetch.apply(this, arguments);
  };
  const _setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    try {
      if (String(name).toLowerCase() === 'authorization') captureFromAuthHeader(value);
    } catch (e) { /* ignore */ }
    return _setHeader.apply(this, arguments);
  };
})();
`;

/**
 * Snippet auto-contenido para pegar en DevTools de Chrome normal (modo manual).
 * Hookea fetch/XHR + imprime el token de forma visible + lo copia al clipboard.
 */
const MANUAL_DEVTOOLS_SNIPPET = `(() => {
  window.__OPAL_TOKEN__ = null;
  const grab = (v) => {
    if (typeof v !== 'string') return;
    if (v.startsWith('Bearer ya29.')) {
      const tok = v.slice(7);
      if (window.__OPAL_TOKEN__ === tok) return;
      window.__OPAL_TOKEN__ = tok;
      console.log('%c✅ TOKEN CAPTURADO — copialo de abajo:', 'color:#0f0;background:#000;font-size:16px;font-weight:bold;padding:6px');
      console.log('%c' + tok, 'background:#222;color:#0f0;font-family:monospace;font-size:13px;padding:8px');
      try { navigator.clipboard.writeText(tok).then(() => console.log('(También copiado al clipboard — Ctrl+V en terminal)')); } catch(e){}
    }
  };
  const _f = window.fetch;
  window.fetch = function(){
    try {
      const h = arguments[1] && arguments[1].headers;
      if (h) {
        if (typeof h.get === 'function') grab(h.get('authorization'));
        else grab(h.Authorization || h.authorization);
      }
    } catch(e){}
    return _f.apply(this, arguments);
  };
  const _x = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(n, v){
    try { if (String(n).toLowerCase() === 'authorization') grab(v); } catch(e){}
    return _x.apply(this, arguments);
  };
  console.log('%c🪝 Hook activo. Apretá F5 para recargar opal.google y disparar la captura.', 'color:#0ff;font-size:14px');
})();`;

export interface CaptureOptions {
  /** If true, run Chrome headless (only works after first interactive login). */
  silent?: boolean;
  /** Override timeout (ms) to wait for the token to appear. */
  timeoutMs?: number;
  /** If true, do not save the token to disk — return it only. */
  noPersist?: boolean;
  /** Skip Playwright entirely and go straight to manual mode. */
  manual?: boolean;
}

export interface CaptureResult {
  accessToken: string;
  savedTo: string | null;
}

async function waitForToken(context: BrowserContext, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      try {
        const token = await page.evaluate(() => (window as any).__OPAL_TOKEN__ as string | null);
        if (token && token.startsWith('ya29.')) return token;
      } catch {
        // Page might be navigating; ignore and retry.
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    'No se capturó el token dentro del tiempo límite. ' +
    'Si la ventana de Chrome quedó abierta, asegurate de loguear con tu cuenta de Google.'
  );
}

function persistToken(token: string, source: string): string {
  ensureDir(AUTH_DIR);
  const payload = {
    access_token: token,
    saved_at: new Date().toISOString(),
    source,
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(payload, null, 2));
  return TOKEN_FILE;
}

/**
 * Modo manual — Plan B cuando Playwright falla (Google bloquea login, red rara, etc.).
 *
 * El usuario abre su Chrome normal, va a opal.google, pega un snippet en DevTools,
 * y vuelve al terminal a pegar el token capturado.
 */
async function manualCapture(): Promise<string> {
  const isWindows = process.platform === 'win32';
  const sep = '═'.repeat(72);

  console.log('');
  console.log(sep);
  console.log('  MODO MANUAL — captura del token desde tu Chrome normal');
  console.log(sep);
  console.log('');
  console.log('  ¿Por qué este modo? El login automatizado de Google requiere');
  console.log('  pasos extra (Playwright detectado, MFA, red corporativa, etc.).');
  console.log('  Este modo usa tu Chrome de toda la vida — más confiable.');
  console.log('');
  console.log('  PASOS:');
  console.log('');
  console.log('  1. Abrí Google Chrome (no Edge, no Firefox).');
  console.log('  2. Andá a:  https://opal.google');
  console.log('  3. Logueate con tu cuenta de Google (la que tiene acceso a Opal).');
  console.log('  4. Cuando veas "Your Opal apps", apretá F12 → tab "Console".');
  console.log('  5. Copiá y pegá ESTE bloque exacto y Enter:');
  console.log('');
  console.log('  ─────── snippet (copialo entero) ───────');
  console.log(MANUAL_DEVTOOLS_SNIPPET);
  console.log('  ─────── fin del snippet ────────────────');
  console.log('');
  console.log('  6. Después de pegarlo, apretá F5 para recargar la página.');
  console.log('  7. Vas a ver en la consola: "✅ TOKEN CAPTURADO" seguido del token.');
  console.log('  8. Seleccioná el token (empieza con ya29.) y Ctrl+C.');
  console.log(`     ${isWindows ? '(O Ctrl+V acá abajo — ya está en tu clipboard)' : ''}`);
  console.log('');
  console.log(sep);
  console.log('');

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    rl.question('🔑 Pegá el token acá y Enter:  ', (answer) => {
      rl.close();
      const token = (answer || '').trim();
      if (!token) {
        reject(new Error('Cancelaste el input.'));
        return;
      }
      if (!token.startsWith('ya29.')) {
        reject(new Error(
          `Token inválido — debe empezar con "ya29." pero recibí "${token.slice(0, 20)}…".\n` +
          `Volvé a opal.google, asegurate de estar logueado y volvé a copiar.`
        ));
        return;
      }
      if (token.length < 50) {
        reject(new Error(
          `Token muy corto (${token.length} chars). Los tokens Google reales tienen 200+. ` +
          `Asegurate de copiar el token entero, no solo el principio.`
        ));
        return;
      }
      resolve(token);
    });
  });
}

/**
 * Localiza el profile real de Google Chrome del usuario en el sistema.
 */
function getUserChromeProfileRoot(): string | null {
  const platform = process.platform;
  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'Google', 'Chrome', 'User Data');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  }
  return path.join(os.homedir(), '.config', 'google-chrome');
}

interface CookieImportResult {
  imported: boolean;
  detail: string;
}

/**
 * Copia las cookies + la clave de encripción del Chrome real del usuario a nuestro
 * profile persistente. Cuando Playwright lance Chrome con este profile, opal.google
 * va a estar YA AUTENTICADO porque las cookies de Google ya están.
 *
 * Esto sidestepea el flujo de sign-in donde Google bloquea Playwright como automation.
 *
 * Best-effort: si Chrome del usuario está abierto (cookies locked) o no existe,
 * devuelve imported=false y caemos al flujo de login manual.
 */
function importUserChromeCookies(targetProfileDir: string): CookieImportResult {
  try {
    const userRoot = getUserChromeProfileRoot();
    if (!userRoot || !fs.existsSync(userRoot)) {
      return { imported: false, detail: 'no encontré Google Chrome instalado' };
    }

    const userDefault = path.join(userRoot, 'Default');
    if (!fs.existsSync(userDefault)) {
      return { imported: false, detail: 'no hay profile "Default" en tu Chrome' };
    }

    // Si ya hay un profile (de un install previo exitoso), no lo pisamos.
    const existingMarkers = [
      path.join(targetProfileDir, 'Default', 'Cookies'),
      path.join(targetProfileDir, 'Default', 'Network', 'Cookies'),
    ];
    if (existingMarkers.some((p) => fs.existsSync(p))) {
      return { imported: false, detail: 'profile previo presente — uso el existente' };
    }

    // Limpio + creo estructura.
    if (fs.existsSync(targetProfileDir)) {
      fs.rmSync(targetProfileDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(targetProfileDir, 'Default'), { recursive: true });

    // 1. Local State — contiene la clave DPAPI para descifrar Cookies.
    const localStateFrom = path.join(userRoot, 'Local State');
    if (fs.existsSync(localStateFrom)) {
      try {
        fs.copyFileSync(localStateFrom, path.join(targetProfileDir, 'Local State'));
      } catch {
        return { imported: false, detail: 'no pude leer "Local State" (cerrá Chrome y reintentá)' };
      }
    }

    // 2. Cookies — pueden estar en Default/Cookies (antiguo) o Default/Network/Cookies (Chrome 96+).
    const cookieLocations: Array<[string, string]> = [
      ['Cookies', 'Cookies'],
      [path.join('Network', 'Cookies'), path.join('Network', 'Cookies')],
    ];
    let copiedCookies = 0;
    for (const [fromRel, toRel] of cookieLocations) {
      const fromPath = path.join(userDefault, fromRel);
      const toPath = path.join(targetProfileDir, 'Default', toRel);
      if (fs.existsSync(fromPath)) {
        try {
          fs.mkdirSync(path.dirname(toPath), { recursive: true });
          fs.copyFileSync(fromPath, toPath);
          copiedCookies++;
        } catch {
          // File puede estar locked si Chrome está abierto. Skip.
        }
      }
    }

    // 3. Preferences (UI/idioma, no auth pero ayuda al fingerprint).
    const prefs = path.join(userDefault, 'Preferences');
    if (fs.existsSync(prefs)) {
      try {
        fs.copyFileSync(prefs, path.join(targetProfileDir, 'Default', 'Preferences'));
      } catch { /* skip */ }
    }

    if (copiedCookies === 0) {
      return { imported: false, detail: 'cookies bloqueadas (cerrá Chrome y reintentá) o no hay sesión Google' };
    }
    return { imported: true, detail: `${copiedCookies} archivo(s) de cookies copiados` };
  } catch (e: any) {
    return { imported: false, detail: e.message };
  }
}

/**
 * Plan A: Playwright launchPersistentContext con stealth flags +
 * sesión importada del Chrome real del usuario.
 */
async function playwrightCapture(silent: boolean, timeoutMs: number): Promise<string> {
  ensureDir(AUTH_DIR);

  // Antes de crear el profile, intentar importar la sesión real del usuario.
  // Si funciona, opal.google va a estar ya logueado y no hay sign-in flow.
  const importResult = importUserChromeCookies(CHROME_PROFILE_DIR);
  if (importResult.imported) {
    console.log(`      · Sesión de tu Chrome importada (${importResult.detail}).`);
    console.log(`      · No deberías necesitar loguear — opal.google se abre ya autenticado.`);
  } else {
    console.log(`      · No importé tu sesión: ${importResult.detail}.`);
    console.log(`      · Vas a tener que loguear en la ventana que aparece.`);
    ensureDir(CHROME_PROFILE_DIR);
  }

  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, {
      channel: 'chrome',
      headless: silent,
      viewport: { width: 1280, height: 800 },
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
    });

    await context.addInitScript({ content: HOOK_SCRIPT });

    const page = context.pages()[0] || (await context.newPage());
    await page.goto(OPAL_URL, { waitUntil: 'domcontentloaded' });

    return await waitForToken(context, timeoutMs);
  } finally {
    if (context) {
      try { await context.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Captura el access token de Google Opal.
 *
 * Plan A (default): Playwright con stealth → captura automática.
 * Plan B (fallback o --manual): instrucciones manuales para DevTools.
 *
 * Si Plan A falla y NO estamos en silent mode, cae a Plan B automáticamente.
 */
export async function captureToken(options: CaptureOptions = {}): Promise<CaptureResult> {
  const { silent = false, timeoutMs = CAPTURE_TIMEOUT_MS, noPersist = false, manual = false } = options;

  // Forzar modo manual si el flag está set.
  if (manual) {
    const token = await manualCapture();
    const savedTo = noPersist ? null : persistToken(token, 'manual-input');
    return { accessToken: token, savedTo };
  }

  // Plan A: Playwright stealth.
  try {
    const token = await playwrightCapture(silent, timeoutMs);
    const savedTo = noPersist ? null : persistToken(token, silent ? 'silent-refresh' : 'playwright');
    return { accessToken: token, savedTo };
  } catch (err: any) {
    if (silent) {
      // En silent mode (refresh automático del MCP server), no podemos pedir input.
      // Propagar el error.
      throw err;
    }

    console.log('');
    console.log('⚠ La captura automática falló:');
    console.log('  ' + (err?.message || err));
    console.log('');
    console.log('   Cambiando a Plan B (modo manual) — más confiable…');

    // Plan B: manual.
    const token = await manualCapture();
    const savedTo = noPersist ? null : persistToken(token, 'manual-fallback');
    return { accessToken: token, savedTo };
  }
}
