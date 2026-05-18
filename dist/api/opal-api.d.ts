export interface OpalApp {
    id: string;
    name: string;
    url: string;
    editUrl: string;
    modifiedTime?: string;
}
export interface OpalAppDetail extends OpalApp {
    nodes: any[];
    edges: any[];
    raw: any;
}
export interface GalleryApp {
    id: string;
    name: string;
    description: string;
    url: string;
}
export declare class OpalAPI {
    private accessToken;
    /**
     * Load saved token from disk
     */
    init(): Promise<void>;
    /**
     * Check if authenticated and token is valid
     */
    isAuthenticated(): Promise<boolean>;
    private apiCall;
    /**
     * Renueva el access token. Estrategia:
     *   1. Si existe refresh_token (OAuth flow clásico), usa el endpoint oficial.
     *   2. Si no, intenta una recaptura silenciosa con el perfil de Chrome cacheado
     *      (el que dejó `opal-mcp-install`).
     * Devuelve true si quedó renovado en memoria + disco; false si no pudo.
     */
    private refreshAccessToken;
    /**
     * List all user's Opal apps (from Google Drive)
     */
    listApps(): Promise<OpalApp[]>;
    /**
     * Get app details (download the Breadboard JSON)
     */
    getApp(appId: string): Promise<OpalAppDetail>;
    createApp(description: string): Promise<{
        id: string;
        name: string;
    }>;
    /**
     * Delete an app (move to trash in Drive)
     */
    deleteApp(appId: string): Promise<boolean>;
    /**
     * Run an app (sends input to the Opal app runner)
     * Note: This uses the App Catalyst API endpoint
     */
    runApp(appId: string, input: string): Promise<string>;
    /**
     * List gallery/template apps
     * These are shared apps visible to all Opal users
     */
    listGallery(): Promise<GalleryApp[]>;
    /**
     * Remix (copy) an app
     */
    remixApp(appId: string): Promise<{
        id: string;
        name: string;
    }>;
    close(): Promise<void>;
}
//# sourceMappingURL=opal-api.d.ts.map