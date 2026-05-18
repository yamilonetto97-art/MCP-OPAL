export interface CaptureOptions {
    /** If true, run Chrome headless (only works after first interactive login). */
    silent?: boolean;
    /** Override timeout (ms) to wait for the token to appear. */
    timeoutMs?: number;
    /** If true, do not save the token to disk — return it only. */
    noPersist?: boolean;
}
export interface CaptureResult {
    accessToken: string;
    savedTo: string | null;
}
/**
 * Launch a persistent Chrome with the cached profile and capture the ya29 access token
 * that Opal sends in its Authorization headers.
 *
 * - silent=false (default): opens a visible window so the user can sign in once.
 * - silent=true: headless refresh using the saved profile (requires a prior interactive run).
 */
export declare function captureToken(options?: CaptureOptions): Promise<CaptureResult>;
//# sourceMappingURL=capture-token.d.ts.map