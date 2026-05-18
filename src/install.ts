#!/usr/bin/env node
/**
 * opal-mcp-install — one-shot installer for the Google Opal MCP server.
 *
 * What it does:
 *   1. Globally installs `opal-mcp-server` so the dist path is stable.
 *   2. Resolves the absolute path to dist/index.js via `npm root -g`.
 *   3. Merges a `google-opal` entry into every detected MCP client config
 *      (Antigravity + Claude Desktop) without touching sibling entries.
 *   4. Opens Chrome with a persistent profile so the user signs in to
 *      Google once; captures the access token from outgoing requests.
 *   5. Saves the token and prints a "restart your MCP client" message.
 *
 * Flags:
 *   --refresh        Skip install + config merge; just re-capture the token.
 *                    Use this when the token expires and silent refresh fails.
 *   --silent         Force the Chrome window to be hidden (only viable after
 *                    a prior interactive run when the profile already has cookies).
 *   --no-install     Skip `npm install -g` (assume the server is already global
 *                    or you intend to launch it via npx/local path).
 *   --help, -h       Show usage.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { captureToken } from './auth/capture-token.js';
import {
  AUTH_DIR,
  TOKEN_FILE,
  getMcpClientTargets,
  ensureDir,
} from './lib/paths.js';

const PACKAGE_NAME = 'opal-mcp-server';
const MCP_ENTRY_NAME = 'google-opal';

interface CliFlags {
  refresh: boolean;
  silent: boolean;
  noInstall: boolean;
  help: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  return {
    refresh: argv.includes('--refresh'),
    silent: argv.includes('--silent'),
    noInstall: argv.includes('--no-install'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printHelp(): void {
  console.log(`
opal-mcp-install — instalador one-shot del MCP de Google Opal

Uso:
  npx opal-mcp-install@latest            Instalación completa (recomendado)
  npx opal-mcp-install@latest --refresh  Solo re-capturar el token expirado

Flags:
  --refresh      Salta install + merge de config; solo recaptura el token
  --silent       Fuerza Chrome headless (solo funciona si ya hubo login previo)
  --no-install   No corre 'npm install -g' (asume el server ya está instalado)
  --help, -h     Muestra esta ayuda

Después de la instalación, reiniciá tu cliente MCP (Antigravity / Claude Desktop)
para que detecte la nueva entrada "${MCP_ENTRY_NAME}".
`);
}

function readPackageVersion(): string {
  // dist/install.js → dist/ → package root
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', 'package.json'),
    path.resolve(here, '..', '..', 'package.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        if (pkg.name === PACKAGE_NAME && pkg.version) return pkg.version as string;
      } catch { /* ignore */ }
    }
  }
  return 'latest';
}

function isWindows(): boolean {
  return process.platform === 'win32';
}

function runNpm(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const cmd = isWindows() ? 'npm.cmd' : 'npm';
  const result = spawnSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    shell: isWindows(),
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function installGlobally(version: string): void {
  const spec = version === 'latest' ? `${PACKAGE_NAME}@latest` : `${PACKAGE_NAME}@${version}`;
  console.log(`\n[1/4] Instalando ${spec} global vía npm…`);
  const res = runNpm(['install', '-g', spec]);
  if (!res.ok) {
    console.error(res.stderr || res.stdout);
    throw new Error(
      `npm install -g falló. ` +
      `En macOS/Linux probá con sudo. ` +
      `En Windows abrí una terminal nueva como Administrador y corré:\n` +
      `  npm install -g ${spec}\n` +
      `Después volvé a correr: npx opal-mcp-install --no-install`
    );
  }
  console.log('      OK');
}

function resolveServerEntry(): string {
  const res = runNpm(['root', '-g']);
  if (!res.ok || !res.stdout) {
    throw new Error('No pude resolver `npm root -g`. ¿Está npm en tu PATH?');
  }
  const entry = path.join(res.stdout, PACKAGE_NAME, 'dist', 'index.js');
  if (!fs.existsSync(entry)) {
    throw new Error(
      `El paquete global no expone dist/index.js en ${entry}. ` +
      `Probablemente el build falló — intentá: npm install -g ${PACKAGE_NAME}@latest`
    );
  }
  return entry;
}

function mergeMcpConfig(configPath: string, serverEntry: string): 'created' | 'updated' | 'unchanged' {
  ensureDir(path.dirname(configPath));

  let config: any = { mcpServers: {} };
  let existed = fs.existsSync(configPath);
  if (existed) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      config = raw.trim() ? JSON.parse(raw) : { mcpServers: {} };
    } catch (err: any) {
      const backup = `${configPath}.corrupt-${Date.now()}.bak`;
      fs.copyFileSync(configPath, backup);
      console.warn(`      ⚠ El config existente no es JSON válido. Backup: ${backup}`);
      config = { mcpServers: {} };
    }
    // Backup the good copy before overwriting.
    fs.copyFileSync(configPath, `${configPath}.bak`);
  }

  if (typeof config !== 'object' || config === null) config = {};
  if (typeof config.mcpServers !== 'object' || config.mcpServers === null) {
    config.mcpServers = {};
  }

  const desired = { command: 'node', args: [serverEntry] };
  const current = config.mcpServers[MCP_ENTRY_NAME];
  const same =
    current &&
    current.command === desired.command &&
    Array.isArray(current.args) &&
    current.args.length === desired.args.length &&
    current.args[0] === desired.args[0];

  if (same) return 'unchanged';

  config.mcpServers[MCP_ENTRY_NAME] = desired;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return existed ? 'updated' : 'created';
}

async function step_install(version: string): Promise<void> {
  installGlobally(version);
}

function step_mergeConfigs(serverEntry: string): void {
  console.log(`\n[2/4] Registrando "${MCP_ENTRY_NAME}" en clientes MCP detectados…`);
  const targets = getMcpClientTargets();
  let touched = 0;
  for (const target of targets) {
    const parentExists = fs.existsSync(path.dirname(target.configPath));
    const fileExists = fs.existsSync(target.configPath);
    if (!parentExists && !fileExists && target.name !== 'Antigravity') {
      // Don't auto-create Claude Desktop config if the app isn't installed.
      console.log(`      · ${target.name}: no instalado, salto.`);
      continue;
    }
    try {
      const result = mergeMcpConfig(target.configPath, serverEntry);
      const verb = result === 'created' ? 'creado' : result === 'updated' ? 'actualizado' : 'ya estaba al día';
      console.log(`      · ${target.name}: ${verb} (${target.configPath})`);
      touched++;
    } catch (err: any) {
      console.error(`      · ${target.name}: ERROR — ${err.message}`);
    }
  }
  if (touched === 0) {
    throw new Error('No se pudo escribir ninguna config MCP.');
  }
}

async function step_captureToken(silent: boolean): Promise<void> {
  console.log(`\n[3/4] Capturando token de Google Opal…`);
  if (!silent) {
    console.log('      Se va a abrir una ventana de Chrome.');
    console.log('      Iniciá sesión con tu cuenta de Google que tiene acceso a Opal.');
    console.log('      Cuando veas "Your Opal apps", la ventana se cerrará sola.');
  }
  ensureDir(AUTH_DIR);
  try {
    const { savedTo } = await captureToken({ silent });
    console.log(`      OK — token guardado en: ${savedTo}`);
  } catch (err: any) {
    throw new Error(
      `No pude capturar el token: ${err.message}\n` +
      `Verificá que: (1) Chrome esté instalado, (2) tu cuenta de Google tenga acceso a https://opal.google, ` +
      `(3) no haya un firewall bloqueando la ejecución.`
    );
  }
}

function step_summary(serverEntry: string): void {
  console.log(`\n[4/4] Listo.`);
  console.log(`      MCP server: ${serverEntry}`);
  console.log(`      Token:      ${TOKEN_FILE}`);
  console.log(`      Perfil:     ${path.join(AUTH_DIR, 'chrome-profile')} (persistente)`);
  console.log('');
  console.log('🎉 Instalación completa.');
  console.log('   Reiniciá Antigravity (o tu cliente MCP) para que detecte "google-opal".');
  console.log('   Probá: "Lista mis apps de Google Opal".');
  console.log('');
  console.log('Si el token expira en el futuro, el server intenta refrescarlo solo en background.');
  console.log('Si eso falla, corré: npx opal-mcp-install --refresh');
}

async function refreshOnly(silent: boolean): Promise<void> {
  console.log('🔄 Refrescando token de Google Opal…');
  await step_captureToken(silent);
  console.log('✅ Token renovado. Ya podés volver a usar las tools de Opal.');
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  console.log('🔮 Google Opal MCP — Instalador');
  console.log('================================');

  if (flags.refresh) {
    await refreshOnly(flags.silent);
    return;
  }

  const version = readPackageVersion();
  if (!flags.noInstall) {
    await step_install(version);
  } else {
    console.log('\n[1/4] Salto npm install -g (--no-install).');
  }

  const serverEntry = resolveServerEntry();
  step_mergeConfigs(serverEntry);
  await step_captureToken(flags.silent);
  step_summary(serverEntry);
}

main().catch((err: any) => {
  console.error('\n❌ Falló la instalación:');
  console.error('   ' + (err?.message || err));
  console.error('\n   Si no entendés el error, pegale este mensaje a tu asistente de IA.');
  process.exit(1);
});
