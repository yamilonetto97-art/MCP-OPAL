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
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { captureToken } from './auth/capture-token.js';
import { AUTH_DIR, TOKEN_FILE, getMcpClientTargets, ensureDir, } from './lib/paths.js';
const MCP_ENTRY_NAME = 'google-opal';
const GITHUB_REPO = 'github:yamilonetto97-art/MCP-OPAL#v0.3.2';
function parseFlags(argv) {
    return {
        refresh: argv.includes('--refresh'),
        silent: argv.includes('--silent'),
        noInstall: argv.includes('--no-install'),
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
 * Detecta dónde vive el paquete actualmente en ejecución.
 * Cuando npx corre `opal-mcp-install`, este archivo es
 * <npx-cache>/node_modules/opal-mcp-server/dist/install.js
 * por lo que la raíz del paquete es subir dos niveles.
 */
function getCurrentPackageRoot() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..');
}
/**
 * Copia el paquete completo (dist + node_modules + package.json + ...) desde
 * el cache de npx a la ruta estable. Atómico-ish: limpia y re-copia.
 */
function installToStableLocation() {
    const src = getCurrentPackageRoot();
    const dst = getStableInstallDir();
    console.log(`      · Origen: ${src}`);
    console.log(`      · Destino: ${dst}`);
    // Sanity check: el origen DEBE tener dist/index.js (lo que vamos a copiar).
    const srcEntry = path.join(src, 'dist', 'index.js');
    if (!fs.existsSync(srcEntry)) {
        throw new Error(`El paquete que se está ejecutando no tiene ${srcEntry}.\n` +
            `Esto significa que el tarball que descargó npx está roto. Probá:\n` +
            `  1. Borrá el cache de npx: rm -rf "%LOCALAPPDATA%\\npm-cache\\_npx" (Windows)\n` +
            `  2. Reintentá el comando original.`);
    }
    // Limpieza atómica: borrar el destino entero antes de copiar.
    if (fs.existsSync(dst)) {
        console.log('      · Limpiando install previo…');
        fs.rmSync(dst, { recursive: true, force: true });
    }
    fs.mkdirSync(dst, { recursive: true });
    // Copia recursiva. cpSync es nativo desde Node 16.7+. Node 18+ es estable.
    console.log('      · Copiando archivos…');
    fs.cpSync(src, dst, {
        recursive: true,
        dereference: false,
        errorOnExist: false,
        force: true,
    });
    const dstEntry = path.join(dst, 'dist', 'index.js');
    if (!fs.existsSync(dstEntry)) {
        throw new Error(`Después de copiar a ${dst}, dist/index.js no aparece. ` +
            `Esto NO debería pasar — reportar como bug.`);
    }
    // Verificación adicional: node_modules debe estar presente para que
    // el server pueda importar @modelcontextprotocol/sdk, playwright-core, zod.
    const nm = path.join(dst, 'node_modules');
    if (!fs.existsSync(nm)) {
        throw new Error(`Después de copiar a ${dst}, node_modules no aparece. ` +
            `npx debería haber instalado las deps antes de correr este script. ` +
            `Probá reintentar con: npx --yes ${GITHUB_REPO}\n`);
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
async function step_captureToken(silent) {
    console.log('\n[3/4] Capturando token de Google Opal…');
    if (!silent) {
        console.log('      Se va a abrir una ventana de Chrome.');
        console.log('      Iniciá sesión con tu cuenta de Google que tiene acceso a Opal.');
        console.log('      Cuando veas "Your Opal apps", la ventana se cerrará sola.');
    }
    ensureDir(AUTH_DIR);
    try {
        const { savedTo } = await captureToken({ silent });
        console.log(`      OK — token guardado en: ${savedTo}`);
    }
    catch (err) {
        throw new Error(`No pude capturar el token: ${err.message}\n` +
            `Verificá que: (1) Chrome esté instalado, (2) tu cuenta de Google tenga acceso a https://opal.google, ` +
            `(3) no haya un firewall bloqueando la ejecución.`);
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
async function refreshOnly(silent) {
    console.log('🔄 Refrescando token de Google Opal…');
    await step_captureToken(silent);
    console.log('✅ Token renovado. Ya podés volver a usar las tools de Opal.');
}
async function main() {
    const flags = parseFlags(process.argv.slice(2));
    if (flags.help) {
        printHelp();
        return;
    }
    console.log('🔮 Google Opal MCP — Instalador v0.3.2');
    console.log('======================================');
    if (flags.refresh) {
        await refreshOnly(flags.silent);
        return;
    }
    let serverEntry;
    if (flags.noInstall) {
        serverEntry = path.join(getStableInstallDir(), 'dist', 'index.js');
        console.log('\n[1/4] Salto copia (--no-install). Usando install existente.');
        if (!fs.existsSync(serverEntry)) {
            throw new Error(`--no-install pero ${serverEntry} no existe. ` +
                `Corré sin --no-install primero para hacer el install completo.`);
        }
    }
    else {
        serverEntry = step_install();
    }
    step_mergeConfigs(serverEntry);
    await step_captureToken(flags.silent);
    step_summary(serverEntry);
}
main().catch((err) => {
    console.error('\n❌ Falló la instalación:');
    console.error('   ' + (err?.message || err));
    console.error('\n   Si no entendés el error, pegale este mensaje a tu asistente de IA.');
    process.exit(1);
});
//# sourceMappingURL=install.js.map