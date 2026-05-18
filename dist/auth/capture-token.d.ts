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
/**
 * Captura el access token de Google Opal.
 *
 * Plan A (default): Playwright con stealth → captura automática.
 * Plan B (fallback o --manual): instrucciones manuales para DevTools.
 *
 * Si Plan A falla y NO estamos en silent mode, cae a Plan B automáticamente.
 */
export declare function captureToken(options?: CaptureOptions): Promise<CaptureResult>;
//# sourceMappingURL=capture-token.d.ts.map