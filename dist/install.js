#!/usr/bin/env node
/**
 * opal-mcp-install — one-shot installer for the Google Opal MCP server.
 *
 * Diseño v0.3.2 — sin npm install -g.
 *
 * El bug crónico de v0.3.0/0.3.1: `npm install -g github:user/repo` en Windows
 * tiene comportamiento impredecible con cache, optimizaciones de "ya está
 * instalado", y reportes de éxito sin haber escrito todos los archivos.
 *
 * La solución de v0.3.2 es simple: cuando npx descarga el paquete para correr
 * `opal-mcp-install`, los archivos YA ESTÁN en disco (en el cache de npx).
 * Solo los copio a una ruta determinística que nosotros controlamos.
 * Sin npm install. Sin cache. Sin --force. Solo `fs.cpSync`.
 *
 * Flags:
 *   --refresh      Salta install + merge de config; solo recaptura el token.
 *   --silent       Chrome headless (solo después de un login interactivo previo).
 *   --no-install   Salta la copia (asume que ya está en la ruta estable).
 *   --help, -h     Esta ayuda.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { captureToken } from './auth/capture-token.js';
import { AUTH_DIR, TOKEN_FILE, getMcpClientTargets, ensureDir, } from './lib/paths.js';
const MCP_ENTRY_NAME = 'google-opal';
const GITHUB_REPO = 'github:yamilonetto97-art/MCP-OPAL#v0.3.6';
const PACKAGE_NAME = 'opal-mcp-server';
function parseFlags(argv) {
    return {
        refresh: argv.includes('--refresh'),
        silent: argv.includes('--silent'),
        noInstall: argv.includes('--no-install'),
        manual: argv.includes('--manual'),
        help: argv.includes('--help') || argv.includes('-h'),
    };
}
function printHelp() {
    console.log(`
opal-mcp-install — instalador one-shot del MCP de Google Opal

Uso:
  npx -y -p ${GITHUB_REPO} opal-mcp-install            Instalación completa (recomendado)
  npx -y -p ${GITHUB_REPO} opal-mcp-install --refresh  Solo re-capturar el token expirado

Flags:
  --refresh      Salta install + merge de config; solo recaptura el token
  --silent       Fuerza Chrome headless (solo funciona si ya hubo login previo)
  --no-install   Salta la copia (asume que el server ya está en la ruta estable)
  --manual       Salta Playwright, va directo al modo manual (Plan B)
  --help, -h     Muestra esta ayuda

Después de la instalación, reiniciá tu cliente MCP (Antigravity / Claude Desktop)
para que detecte la nueva entrada "${MCP_ENTRY_NAME}".
`);
}
/**
 * Ruta determinística donde vive el MCP server después del install.
 * NO depende de npm prefix ni del comportamiento de npm install -g.
 */
function getStableInstallDir() {
    const platform = process.platform;
    const home = process.env.USERPROFILE || process.env.HOME || '';
    if (platform === 'win32') {
        const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        return path.join(local, 'opal-mcp', 'server');
    }
    if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'opal-mcp', 'server');
    }
    return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opal-mcp', 'server');
}
/**
 * Detecta la raíz del install (donde está el node_modules con deps hoisted).
 *
 * Cuando npx corre `opal-mcp-install`, este archivo está en:
 *   <npx-cache>/node_modules/opal-mcp-server/dist/install.js
 *
 * npm hoistea las deps a node_modules/ (siblings del paquete), no dentro.
 * Necesitamos copiar el node_modules ENTERO para llevar el paquete + sus deps.
 */
function getInstallSourceRoot() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const packageRoot = path.resolve(here, '..'); // .../node_modules/opal-mcp-server
    const nodeModulesDir = path.resolve(packageRoot, '..'); // .../node_modules
    if (path.basename(nodeModulesDir) !== 'node_modules') {
        throw new Error(`Estructura inesperada — packageRoot=${packageRoot} no está bajo node_modules. ` +
            `Esto puede pasar si corriste install.js directamente desde el repo en vez de via npx.`);
    }
    return { packageRoot, nodeModulesDir };
}
/**
 * Copia el node_modules entero (paquete + deps hoisted) a una ubicación estable.
 * Esto sidestepea por completo el comportamiento opaco de `npm install -g` en Windows.
 */
function installToStableLocation() {
    const { packageRoot, nodeModulesDir } = getInstallSourceRoot();
    const dst = getStableInstallDir();
    const dstNodeModules = path.join(dst, 'node_modules');
    console.log(`      · Origen (paquete): ${packageRoot}`);
    console.log(`      · Origen (deps):    ${nodeModulesDir}`);
    console.log(`      · Destino:          ${dst}`);
    // Sanity check del origen.
    const srcEntry = path.join(packageRoot, 'dist', 'index.js');
    if (!fs.existsSync(srcEntry)) {
        throw new Error(`El paquete origen no tiene ${srcEntry}. El tarball está roto.`);
    }
    // Limpieza atómica del destino entero.
    if (fs.existsSync(dst)) {
        console.log('      · Limpiando install previo…');
        fs.rmSync(dst, { recursive: true, force: true });
    }
    fs.mkdirSync(dstNodeModules, { recursive: true });
    // Copia el node_modules entero (incluye el paquete + todas las deps hoisted).
    console.log('      · Copiando node_modules entero (paquete + deps)…');
    fs.cpSync(nodeModulesDir, dstNodeModules, {
        recursive: true,
        dereference: false,
        errorOnExist: false,
        force: true,
    });
    // El entry point real: <dst>/node_modules/opal-mcp-server/dist/index.js
    const dstEntry = path.join(dstNodeModules, PACKAGE_NAME, 'dist', 'index.js');
    if (!fs.existsSync(dstEntry)) {
        throw new Error(`Copy falló: ${dstEntry} no existe después de copiar.`);
    }
    // Verificación de deps críticas.
    const criticalDeps = ['@modelcontextprotocol/sdk', 'playwright-core', 'zod'];
    for (const dep of criticalDeps) {
        const depPath = path.join(dstNodeModules, dep);
        if (!fs.existsSync(depPath)) {
            throw new Error(`Dep crítica falta: ${depPath}. ` +
                `npx debió instalar deps antes de correr install. Reintentá con: npx --yes ${GITHUB_REPO}`);
        }
    }
    return dstEntry;
}
function mergeMcpConfig(configPath, serverEntry) {
    ensureDir(path.dirname(configPath));
    let config = { mcpServers: {} };
    const existed = fs.existsSync(configPath);
    if (existed) {
        try {
            const raw = fs.readFileSync(configPath, 'utf-8');
            config = raw.trim() ? JSON.parse(raw) : { mcpServers: {} };
        }
        catch {
            const backup = `${configPath}.corrupt-${Date.now()}.bak`;
            fs.copyFileSync(configPath, backup);
            console.warn(`      ⚠ El config existente no es JSON válido. Backup: ${backup}`);
            config = { mcpServers: {} };
        }
        fs.copyFileSync(configPath, `${configPath}.bak`);
    }
    if (typeof config !== 'object' || config === null)
        config = {};
    if (typeof config.mcpServers !== 'object' || config.mcpServers === null) {
        config.mcpServers = {};
    }
    const desired = { command: 'node', args: [serverEntry] };
    const current = config.mcpServers[MCP_ENTRY_NAME];
    const same = current &&
        current.command === desired.command &&
        Array.isArray(current.args) &&
        current.args.length === desired.args.length &&
        current.args[0] === desired.args[0];
    if (same)
        return 'unchanged';
    config.mcpServers[MCP_ENTRY_NAME] = desired;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    return existed ? 'updated' : 'created';
}
/**
 * Limpia cualquier instalación global legacy de versiones viejas (v0.3.0/0.3.1)
 * que usaban `npm install -g`. Sin esto, npx puede preferir el bin legacy del
 * PATH del usuario por sobre el fresh fetch del spec.
 *
 * Idempotente: si no hay nada que limpiar, no falla.
 */
function cleanupLegacyGlobalInstall() {
    console.log('\n[0/4] Limpiando instalaciones legacy (si las hay)…');
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(cmd, ['uninstall', '-g', PACKAGE_NAME], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
        shell: process.platform === 'win32',
    });
    if (result.status === 0) {
        const out = (result.stdout || '').trim();
        if (out.includes('removed')) {
            console.log(`      · Removido install global previo.`);
        }
        else {
            console.log('      · No había install global previo (OK).');
        }
    }
    else {
        // npm uninstall puede dar warnings pero no es fatal — el flujo nuevo no depende
        // de un estado limpio del global npm.
        console.log('      · npm uninstall reportó algo, lo ignoro (no es fatal).');
    }
}
function step_install() {
    console.log('\n[1/4] Copiando MCP server a ubicación estable…');
    const entry = installToStableLocation();
    console.log(`      OK — ${entry}`);
    return entry;
}
function step_mergeConfigs(serverEntry) {
    console.log(`\n[2/4] Registrando "${MCP_ENTRY_NAME}" en clientes MCP detectados…`);
    const targets = getMcpClientTargets();
    let touched = 0;
    for (const target of targets) {
        const parentExists = fs.existsSync(path.dirname(target.configPath));
        const fileExists = fs.existsSync(target.configPath);
        if (!parentExists && !fileExists && target.name !== 'Antigravity') {
            console.log(`      · ${target.name}: no instalado, salto.`);
            continue;
        }
        try {
            const result = mergeMcpConfig(target.configPath, serverEntry);
            const verb = result === 'created' ? 'creado' : result === 'updated' ? 'actualizado' : 'ya estaba al día';
            console.log(`      · ${target.name}: ${verb} (${target.configPath})`);
            touched++;
        }
        catch (err) {
            console.error(`      · ${target.name}: ERROR — ${err.message}`);
        }
    }
    if (touched === 0) {
        throw new Error('No se pudo escribir ninguna config MCP.');
    }
}
async function step_captureToken(silent, manual) {
    console.log('\n[3/4] Capturando token de Google Opal…');
    if (manual) {
        console.log('      Modo manual forzado (--manual).');
    }
    else if (!silent) {
        console.log('      Intentando importar tu sesión de Chrome…');
        console.log('      Si tu Chrome está logueado en Google, NO necesitás loguear de nuevo.');
        console.log('      Tip: si Chrome del sistema está abierto, cerralo para que pueda leer cookies.');
    }
    ensureDir(AUTH_DIR);
    try {
        const { savedTo } = await captureToken({ silent, manual });
        console.log(`      OK — token guardado en: ${savedTo}`);
    }
    catch (err) {
        throw new Error(`No pude capturar el token (Plan A ni Plan B funcionaron): ${err.message}\n` +
            `Verificá que: (1) tu cuenta de Google tenga acceso aprobado a https://opal.google, ` +
            `(2) no haya un firewall bloqueando, (3) el token que pegaste empiece con "ya29.".`);
    }
}
function step_summary(serverEntry) {
    console.log('\n[4/4] Listo.');
    console.log(`      MCP server: ${serverEntry}`);
    console.log(`      Token:      ${TOKEN_FILE}`);
    console.log(`      Perfil:     ${path.join(AUTH_DIR, 'chrome-profile')} (persistente)`);
    console.log('');
    console.log('🎉 Instalación completa.');
    console.log('   Reiniciá Antigravity (o tu cliente MCP) para que detecte "google-opal".');
    console.log('   Probá: "Lista mis apps de Google Opal".');
    console.log('');
    console.log('Si el token expira en el futuro, el server intenta refrescarlo solo en background.');
    console.log(`Si eso falla, corré: npx -y -p ${GITHUB_REPO} opal-mcp-install --refresh`);
}
async function refreshOnly(silent, manual) {
    console.log('🔄 Refrescando token de Google Opal…');
    await step_captureToken(silent, manual);
    console.log('✅ Token renovado. Ya podés volver a usar las tools de Opal.');
}
async function main() {
    const flags = parseFlags(process.argv.slice(2));
    if (flags.help) {
        printHelp();
        return;
    }
    console.log('🔮 Google Opal MCP — Instalador v0.3.6');
    console.log('======================================');
    if (flags.refresh) {
        await refreshOnly(flags.silent, flags.manual);
        return;
    }
    let serverEntry;
    if (flags.noInstall) {
        serverEntry = path.join(getStableInstallDir(), 'node_modules', PACKAGE_NAME, 'dist', 'index.js');
        console.log('\n[1/4] Salto copia (--no-install). Usando install existente.');
        if (!fs.existsSync(serverEntry)) {
            throw new Error(`--no-install pero ${serverEntry} no existe. ` +
                `Corré sin --no-install primero para hacer el install completo.`);
        }
    }
    else {
        cleanupLegacyGlobalInstall();
        serverEntry = step_install();
    }
    step_mergeConfigs(serverEntry);
    await step_captureToken(flags.silent, flags.manual);
    step_summary(serverEntry);
}
main().catch((err) => {
    console.error('\n❌ Falló la instalación:');
    console.error('   ' + (err?.message || err));
    console.error('\n   Si no entendés el error, pegale este mensaje a tu asistente de IA.');
    process.exit(1);
});
//# sourceMappingURL=install.js.map