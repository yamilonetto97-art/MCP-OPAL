export declare function getAuthDir(): string;
export declare const AUTH_DIR: string;
export declare const TOKEN_FILE: string;
export declare const CHROME_PROFILE_DIR: string;
export interface McpClientTarget {
    name: string;
    configPath: string;
}
export declare function getMcpClientTargets(): McpClientTarget[];
export declare function ensureDir(dir: string): void;
//# sourceMappingURL=paths.d.ts.map