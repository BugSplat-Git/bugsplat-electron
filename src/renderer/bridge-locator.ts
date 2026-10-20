import {
    createBridge,
    type CrashReporterRendererLike,
    type IpcRendererLike,
} from '../shared/bridge';
import type { Logger } from '../shared/logger';
import { BRIDGE_KEY, type BugSplatBridge } from '../shared/protocol';

export type LocatedBridge =
    { mode: 'bridge' | 'ipc'; bridge: BugSplatBridge } | { mode: 'http'; bridge: null };

interface ElectronModuleLike {
    ipcRenderer?: IpcRendererLike;
    crashReporter?: CrashReporterRendererLike;
}

/**
 * Find a way to talk to the main process:
 * 1. `window.__bugsplat` exposed by the SDK preload (contextIsolation on or off),
 * 2. `require('electron').ipcRenderer` when nodeIntegration is on and no preload is present,
 * 3. otherwise HTTP mode (direct posts to BugSplat from the renderer).
 */
export function locateBridge(scope: Window, sdkVersion: string, logger?: Logger): LocatedBridge {
    const win = scope as unknown as Record<string, unknown>;
    const exposed = win[BRIDGE_KEY];
    if (exposed && typeof (exposed as BugSplatBridge).post === 'function') {
        return { mode: 'bridge', bridge: exposed as BugSplatBridge };
    }
    const req = win.require;
    if (typeof req === 'function') {
        try {
            const electron = (req as (id: string) => ElectronModuleLike)('electron');
            if (electron?.ipcRenderer) {
                const bridge = createBridge({
                    ipcRenderer: electron.ipcRenderer,
                    crashReporter: electron.crashReporter ?? null,
                    isMainFrame: scope.self === scope.top,
                    contextIsolated: false,
                    sandboxed: false,
                    sdkVersion,
                    logger,
                });
                return { mode: 'ipc', bridge };
            }
        } catch {
            // not an Electron renderer with node integration
        }
    }
    return { mode: 'http', bridge: null };
}
