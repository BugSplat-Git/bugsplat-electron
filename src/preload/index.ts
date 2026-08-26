/**
 * @bugsplat/electron preload. Registered into every session by `init()` in the main process
 * (or imported from your own preload). Self-contained: only requires `electron`.
 */
import { contextBridge, crashReporter, ipcRenderer } from 'electron';
import { createBridge } from '../shared/bridge';
import { createLogger } from '../shared/logger';
import { BRIDGE_KEY, type PostRequest } from '../shared/protocol';
import { serializeErrorEvent } from '../shared/serialize-error';

const INSTALLED_FLAG = '__bugsplatPreloadInstalled';

let cleanup: (() => void) | null = null;

/** @internal Test hook: remove listeners and allow `installPreload()` to run again. */
export function uninstallPreload(): void {
    cleanup?.();
    cleanup = null;
    delete (globalThis as unknown as Record<string, unknown>)[INSTALLED_FLAG];
}

type ElectronProcess = NodeJS.Process & {
    isMainFrame?: boolean;
    contextIsolated?: boolean;
    sandboxed?: boolean;
};

/** @internal Exposed for tests; the module runs it on load. */
export function installPreload(): void {
    const scope = globalThis as unknown as Record<string, unknown>;
    if (scope[INSTALLED_FLAG]) {
        return;
    }
    scope[INSTALLED_FLAG] = true;

    const proc = process as ElectronProcess;
    const hasWindow = typeof window !== 'undefined';
    const isMainFrame =
        typeof proc.isMainFrame === 'boolean'
            ? proc.isMainFrame
            : hasWindow
              ? window.self === window.top
              : true;
    if (!isMainFrame) {
        return;
    }

    const logger = createLogger(console, '[bugsplat preload]');
    let fallbackListener: ((event: ErrorEvent) => void) | null = null;
    const removeFallback = (): void => {
        if (fallbackListener && hasWindow) {
            window.removeEventListener('error', fallbackListener);
            fallbackListener = null;
        }
    };

    const bridge = createBridge({
        ipcRenderer,
        crashReporter,
        isMainFrame,
        contextIsolated: proc.contextIsolated === true,
        sandboxed: proc.sandboxed === true,
        sdkVersion: __SDK_VERSION__,
        logger,
        onClaim: removeFallback,
    });

    const config = bridge.getConfig();
    if (hasWindow && config?.capture.fallback && config.capture.errors) {
        fallbackListener = (event: ErrorEvent): void => {
            const href = config.capture.includeUrl ? window.location.href : undefined;
            const request: PostRequest = {
                kind: 'crash',
                origin: 'renderer.error',
                error: serializeErrorEvent(event, href ?? '<renderer>'),
                context: {
                    href,
                    visibilityState: document.visibilityState,
                    isTopLevel: true,
                    capture: 'preload',
                },
            };
            void bridge.post(request);
        };
        window.addEventListener('error', fallbackListener);
    }
    cleanup = removeFallback;

    if (proc.contextIsolated) {
        try {
            contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
        } catch (error) {
            logger.error('failed to expose the bridge', error);
        }
    } else if (hasWindow) {
        (window as unknown as Record<string, unknown>)[BRIDGE_KEY] = bridge;
    }
}

try {
    installPreload();
} catch (error) {
    console.error('[bugsplat preload] failed to initialize', error);
}
