import * as fs from 'fs';
import { chromium } from 'playwright-core';
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
async function waitForToken(context, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const page of context.pages()) {
            try {
                const token = await page.evaluate(() => window.__OPAL_TOKEN__);
                if (token && token.startsWith('ya29.'))
                    return token;
            }
            catch {
                // Page might be navigating; ignore and retry.
            }
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('No se capturó el token dentro del tiempo límite. ' +
        'Si la ventana de Chrome quedó abierta, asegurate de loguear con tu cuenta de Google.');
}
/**
 * Launch a persistent Chrome with the cached profile and capture the ya29 access token
 * that Opal sends in its Authorization headers.
 *
 * - silent=false (default): opens a visible window so the user can sign in once.
 * - silent=true: headless refresh using the saved profile (requires a prior interactive run).
 */
export async function captureToken(options = {}) {
    const { silent = false, timeoutMs = CAPTURE_TIMEOUT_MS, noPersist = false } = options;
    ensureDir(AUTH_DIR);
    ensureDir(CHROME_PROFILE_DIR);
    let context = null;
    try {
        context = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, {
            channel: 'chrome',
            headless: silent,
            viewport: { width: 1280, height: 800 },
            args: ['--no-first-run', '--no-default-browser-check'],
        });
        await context.addInitScript({ content: HOOK_SCRIPT });
        const page = context.pages()[0] || (await context.newPage());
        await page.goto(OPAL_URL, { waitUntil: 'domcontentloaded' });
        const token = await waitForToken(context, timeoutMs);
        let savedTo = null;
        if (!noPersist) {
            const payload = {
                access_token: token,
                saved_at: new Date().toISOString(),
                source: silent ? 'silent-refresh' : 'interactive-install',
            };
            fs.writeFileSync(TOKEN_FILE, JSON.stringify(payload, null, 2));
            savedTo = TOKEN_FILE;
        }
        return { accessToken: token, savedTo };
    }
    finally {
        if (context) {
            try {
                await context.close();
            }
            catch { /* ignore */ }
        }
    }
}
//# sourceMappingURL=capture-token.js.map