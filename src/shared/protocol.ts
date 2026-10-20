import type { IdentityPatch, IdentitySnapshot } from './identity';

export const PROTOCOL_VERSION = 1;

/** Name of the bridge object exposed on `window` by the preload script. */
export const BRIDGE_KEY = '__bugsplat';

export const CHANNELS = {
    /** preload → main, `ipcRenderer.sendSync`, once per top-level frame at preload time. */
    hello: 'bugsplat:hello',
    /** renderer → main, `ipcRenderer.invoke`. */
    post: 'bugsplat:post',
    /** renderer → main, `ipcRenderer.invoke`. */
    update: 'bugsplat:update',
    /** main → frame, `webFrameMain.send`. */
    identity: 'bugsplat:identity',
} as const;

export const LIMITS = {
    stackBytes: 32 * 1024,
    messageBytes: 4 * 1024,
    maxAttributes: 64,
    attributeValueBytes: 20320,
    attachmentBytes: 10 * 1024 * 1024,
    causeDepth: 3,
} as const;

export interface CaptureConfig {
    errors: boolean;
    unhandledRejections: boolean;
    fallback: boolean;
    includeUrl: boolean;
}

export interface BridgeConfig {
    database: string;
    application: string;
    version: string;
    sdkVersion: string;
    capture: CaptureConfig;
}

export interface HelloRequest {
    protocolVersion: number;
    sdkVersion: string;
    isMainFrame: boolean;
    contextIsolated: boolean;
    sandboxed: boolean;
}

export interface HelloResponse {
    protocolVersion: number;
    config: BridgeConfig;
    identity: IdentitySnapshot;
}

export interface SerializedError {
    name: string;
    message: string;
    stack: string;
    cause?: SerializedError;
}

export type ReportOrigin =
    | 'renderer.error'
    | 'renderer.unhandledrejection'
    | 'renderer.manual'
    | 'renderer.feedback'
    | 'main.uncaughtException'
    | 'main.unhandledRejection'
    | 'main.manual'
    | 'main.feedback'
    | 'render-process-gone'
    | 'child-process-gone'
    | 'unresponsive'
    | 'preload-error';

export interface RendererContext {
    href?: string;
    visibilityState?: string;
    isTopLevel: boolean;
    capture: 'renderer' | 'preload';
}

export interface SerializedAttachment {
    filename: string;
    data: Uint8Array;
}

export interface SerializedPostOptions {
    appKey?: string;
    user?: string;
    email?: string;
    description?: string;
    attributes?: Record<string, string>;
    attachments?: SerializedAttachment[];
}

export interface PostRequest {
    kind: 'crash' | 'feedback';
    origin: ReportOrigin;
    error?: SerializedError;
    title?: string;
    options?: SerializedPostOptions;
    context: RendererContext;
}

export interface PostResult {
    error: string | null;
    response: unknown;
}

export interface IdentityMessage {
    identity: IdentitySnapshot;
}

/** Shape of `window.__bugsplat` as exposed by the preload script. */
export interface BugSplatBridge {
    readonly protocolVersion: number;
    /** Mode at expose time: `'no-main'` when the main process did not answer the hello. */
    readonly mode: 'main' | 'no-main';
    /** Current mode (upgrades to `'main'` if the main process initializes later). */
    getMode(): 'main' | 'no-main';
    getConfig(): BridgeConfig | null;
    getIdentity(): IdentitySnapshot | null;
    onIdentity(listener: (snapshot: IdentitySnapshot) => void): () => void;
    post(request: PostRequest): Promise<PostResult>;
    update(patch: IdentityPatch): Promise<void>;
    /** Called by the renderer SDK once it owns error capture; the preload stops its fallback capture. */
    claim(): void;
}
