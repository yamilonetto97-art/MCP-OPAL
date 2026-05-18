import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
export function getAuthDir() {
    const platform = os.platform();
    if (platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'opal-mcp');
    }
    if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'opal-mcp');
    }
    return path.join(os.homedir(), '.config', 'opal-mcp');
}
export const AUTH_DIR = getAuthDir();
export const TOKEN_FILE = path.join(AUTH_DIR, 'oauth-token.json');
export const CHROME_PROFILE_DIR = path.join(AUTH_DIR, 'chrome-profile');
export function getMcpClientTargets() {
    const home = os.homedir();
    const platform = os.platform();
    const targets = [
        { name: 'Antigravity', configPath: path.join(home, '.gemini', 'antigravity', 'mcp_config.json') },
    ];
    if (platform === 'win32') {
        targets.push({
            name: 'Claude Desktop',
            configPath: path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json'),
        });
    }
    else if (platform === 'darwin') {
        targets.push({
            name: 'Claude Desktop',
            configPath: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
        });
    }
    else {
        targets.push({
            name: 'Claude Desktop',
            configPath: path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
        });
    }
    return targets;
}
export function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
//# sourceMappingURL=paths.js.map