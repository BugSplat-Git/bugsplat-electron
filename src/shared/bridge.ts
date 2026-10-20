import { diffExtras, toNativeExtras, type IdentityPatch, type IdentitySnapshot } from './identity';
import type { Logger } from './logger';
import {
    CHANNELS,
    PROTOCOL_VERSION,
    type BridgeConfig,
    type BugSplatBridge,
    type HelloRequest,
    type HelloResponse,
    type IdentityMessage,
    type PostRequest,
    type PostResult,
} from './protocol';

export interface IpcRendererLike {
    sendSync(channel: string, ...args: unknown[]): unknown;
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

export interface CrashReporterRendererLike {
    addExtraParameter(key: string, value: string): void;
    removeExtraParameter(key: string): void;
}

export interface BridgeDeps {
    ipcRenderer: IpcRendererLike;
    /** Per-process crash keys are applied here; `null` when unavailable. */
    crashReporter?: CrashReporterRendererLike | null;
    isMainFrame: boolean;
    contextIsolated: boolean;
    sandboxed: boolean;
    sdkVersion: string;
    logger?: Logger;
    /** Invoked when the renderer SDK claims capture. */
    onClaim?: () => void;
}

/**
 * The renderer-side half of the IPC protocol. Used by the preload (exposed via contextBridge)
 * and by the renderer SDK directly when `nodeIntegration` gives it `ipcRenderer`.
 *
 * Does one synchronous hello so crash keys are in place before page scripts run, then
 * listens for identity broadcasts and applies diffs to this process's crash keys.
 */
export function createBridge(deps: BridgeDeps): BugSplatBridge {
    const logger = deps.logger;
    let config: BridgeConfig | null = null;
    let identity: IdentitySnapshot | null = null;
    let mode: 'main' | 'no-main' = 'no-main';
    let lastSeq = -1;
    let applied: Record<string, string> = {};
    const listeners = new Set<(snapshot: IdentitySnapshot) => void>();

    const isSnapshot = (
        snapshot: IdentitySnapshot | null | undefined,
    ): snapshot is IdentitySnapshot => !!snapshot && typeof snapshot.seq === 'number';

    const applyIdentity = (snapshot: IdentitySnapshot | null | undefined): void => {
        if (!isSnapshot(snapshot) || snapshot.seq <= lastSeq) {
            return;
        }
        lastSeq = snapshot.seq;
        identity = snapshot;
        if (deps.crashReporter) {
            const next = toNativeExtras(snapshot);
            const { set, remove } = diffExtras(applied, next);
            for (const key of remove) {
                try {
                    deps.crashReporter.removeExtraParameter(key);
                } catch (error) {
                    logger?.warn(`removeExtraParameter("${key}") failed`, error);
                }
            }
            for (const [key, value] of Object.entries(set)) {
                try {
                    deps.crashReporter.addExtraParameter(key, value);
                } catch (error) {
                    logger?.warn(`addExtraParameter("${key}") failed`, error);
                }
            }
            applied = next;
        }
        for (const listener of listeners) {
            try {
                listener(snapshot);
            } catch (error) {
                logger?.error('identity listener failed', error);
            }
        }
    };

    try {
        deps.ipcRenderer.on(CHANNELS.identity, (_event, message) => {
            const snapshot = (message as IdentityMessage | undefined)?.identity;
            if (isSnapshot(snapshot)) {
                mode = 'main';
            }
            applyIdentity(snapshot);
        });
    } catch (error) {
        logger?.warn('could not subscribe to identity updates', error);
    }

    const hello: HelloRequest = {
        protocolVersion: PROTOCOL_VERSION,
        sdkVersion: deps.sdkVersion,
        isMainFrame: deps.isMainFrame,
        contextIsolated: deps.contextIsolated,
        sandboxed: deps.sandboxed,
    };
    try {
        const response = deps.ipcRenderer.sendSync(CHANNELS.hello, hello) as
            HelloResponse | null | undefined;
        if (response && typeof response === 'object' && response.config) {
            mode = 'main';
            config = response.config;
            applyIdentity(response.identity);
        }
    } catch (error) {
        logger?.warn('hello failed; is @bugsplat/electron initialized in the main process?', error);
    }

    return {
        protocolVersion: PROTOCOL_VERSION,
        mode,
        getMode: () => mode,
        getConfig: () => config,
        getIdentity: () => identity,
        onIdentity: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        post: async (request: PostRequest): Promise<PostResult> => {
            try {
                const result = (await deps.ipcRenderer.invoke(CHANNELS.post, request)) as
                    PostResult | undefined;
                if (!result || typeof result !== 'object') {
                    return { error: 'no response from main process', response: null };
                }
                return result;
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : String(error),
                    response: null,
                };
            }
        },
        update: async (patch: IdentityPatch): Promise<void> => {
            try {
                await deps.ipcRenderer.invoke(CHANNELS.update, patch);
            } catch (error) {
                logger?.warn('identity update failed', error);
            }
        },
        claim: () => {
            try {
                deps.onClaim?.();
            } catch (error) {
                logger?.warn('claim failed', error);
            }
        },
    };
}
