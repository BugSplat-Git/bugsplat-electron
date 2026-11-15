import type { IdentityPatch, IdentitySnapshot } from './identity';

/**
 * Bump only for a change that an older main process, preload or renderer SDK cannot ignore.
 * Optional additions do not need it: the main process rebuilds every request from the fields
 * it knows, a one-way message on a channel it does not listen on is dropped, and the renderer
 * SDK checks that a bridge method exists before calling it.
 */
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
    /** renderer → main, `ipcRenderer.send` (one-way). */
    debugIds: 'bugsplat:debug-ids',
} as const;

export const LIMITS = {
    stackBytes: 32 * 1024,
    messageBytes: 4 * 1024,
    maxAttributes: 64,
    attributeValueBytes: 20320,
    attachmentBytes: 10 * 1024 * 1024,
    causeDepth: 3,
    /** Source map debug IDs sent with one report. */
    debugIdsPerReport: 128,
    /** Source map debug IDs a page registers with the main process for hang reports. */
    debugIdsPerPage: 1024,
    /** Length of one file name (UTF-16 code units, like the two below). */
    debugIdFileLength: 2048,
    /** Summed length of the file names in one set of debug IDs. */
    debugIdFilesLength: 256 * 1024,
    debugIdLength: 64,
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
    /**
     * Source map debug IDs of the scripts named in `error`'s stacks: file, exactly as the stack
     * frames name it, to the debug ID its build wrote.
     */
    debugIds?: Record<string, string>;
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
    /**
     * Replace the source map debug IDs the main process keeps for this page (file to debug ID).
     * It adds them to hang reports, which it builds while the page cannot answer. Missing on
     * bridges exposed by a preload older than this method.
     */
    setDebugIds?(debugIds: Record<string, string>): void;
}
