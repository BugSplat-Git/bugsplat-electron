/**
 * Minimal `electron` mock for unit tests (vitest aliases `electron` → this file).
 * `app` is a real EventEmitter so tests can drive behaviour with `app.emit(...)`.
 */
import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

class FakeSession extends EventEmitter {
    preloadScripts: Array<{ type: string; id?: string; filePath: string }> = [];
    registerPreloadScript = vi.fn((script: { type: string; id?: string; filePath: string }) => {
        this.preloadScripts.push(script);
        return script.id ?? `preload-${this.preloadScripts.length}`;
    });
    unregisterPreloadScript = vi.fn((id: string) => {
        this.preloadScripts = this.preloadScripts.filter((s) => s.id !== id);
    });
    getPreloadScripts = vi.fn(() => this.preloadScripts);
    webRequest = { onHeadersReceived: vi.fn() };
    fetch = vi.fn();
}

export const app = Object.assign(new EventEmitter(), {
    name: 'FakeApp',
    getName: vi.fn(() => 'FakeApp'),
    getVersion: vi.fn(() => '1.2.3'),
    isReady: vi.fn(() => false),
    whenReady: vi.fn(() => Promise.resolve()),
    exit: vi.fn(),
    quit: vi.fn(),
    getPath: vi.fn(() => '/tmp/fake'),
    commandLine: {
        hasSwitch: vi.fn(() => false),
        getSwitchValue: vi.fn(() => ''),
        appendSwitch: vi.fn(),
    },
});

export const crashReporter = {
    start: vi.fn(),
    addExtraParameter: vi.fn(),
    removeExtraParameter: vi.fn(),
    getParameters: vi.fn(() => ({}) as Record<string, string>),
    getLastCrashReport: vi.fn(() => null),
    getUploadedReports: vi.fn(() => []),
    getUploadToServer: vi.fn(() => true),
    setUploadToServer: vi.fn(),
};

export const ipcMain = {
    handle: vi.fn(),
    removeHandler: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
};

export const ipcRenderer = {
    invoke: vi.fn(async () => ({})),
    send: vi.fn(),
    sendSync: vi.fn(() => null),
    on: vi.fn(),
    removeListener: vi.fn(),
};

export const contextBridge = {
    exposeInMainWorld: vi.fn(),
};

export const session = {
    defaultSession: new FakeSession(),
    fromPartition: vi.fn(() => new FakeSession()),
    FakeSession,
};

export const webContents = {
    getAllWebContents: vi.fn((): unknown[] => []),
    fromId: vi.fn(() => undefined),
};

export const BrowserWindow = {
    fromWebContents: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
};

export const net = {
    fetch: vi.fn(),
};

export const utilityProcess = {
    fork: vi.fn(),
};

export const protocol = {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
};

export default {
    app,
    crashReporter,
    ipcMain,
    ipcRenderer,
    contextBridge,
    session,
    webContents,
    BrowserWindow,
    net,
    utilityProcess,
    protocol,
};
