// @vitest-environment happy-dom
import { contextBridge, crashReporter, ipcRenderer } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyIdentity } from '../../src/shared/identity';
import { CHANNELS, PROTOCOL_VERSION, type BugSplatBridge } from '../../src/shared/protocol';

const proc = process as unknown as {
    isMainFrame?: boolean;
    contextIsolated?: boolean;
    sandboxed?: boolean;
};

const helloResponse = (fallback = true) => ({
    protocolVersion: PROTOCOL_VERSION,
    config: {
        database: 'fred',
        application: 'app',
        version: '1',
        sdkVersion: 'x',
        capture: { errors: true, unhandledRejections: true, fallback, includeUrl: true },
    },
    identity: { ...emptyIdentity(), seq: 1, email: 'a@b.c' },
});

async function loadPreload() {
    const { installPreload, uninstallPreload } = await import('../../src/preload/index');
    uninstallPreload();
    installPreload();
}

function exposedBridge(): BugSplatBridge {
    const call = (contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    return call?.[1] as BugSplatBridge;
}

describe('preload', () => {
    beforeEach(() => {
        delete (globalThis as Record<string, unknown>).__bugsplatPreloadInstalled;
        delete (window as unknown as Record<string, unknown>).__bugsplat;
        proc.isMainFrame = true;
        proc.contextIsolated = true;
        proc.sandboxed = true;
        (ipcRenderer.sendSync as ReturnType<typeof vi.fn>).mockReturnValue(helloResponse());
    });

    afterEach(() => {
        delete proc.isMainFrame;
        delete proc.contextIsolated;
        delete proc.sandboxed;
    });

    it('exposes the bridge through contextBridge and applies crash keys', async () => {
        await loadPreload();
        expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith(
            '__bugsplat',
            expect.any(Object),
        );
        const bridge = exposedBridge();
        expect(bridge.mode).toBe('main');
        expect(bridge.getConfig()?.database).toBe('fred');
        expect(crashReporter.addExtraParameter).toHaveBeenCalledWith('email', 'a@b.c');
        expect(ipcRenderer.sendSync).toHaveBeenCalledWith(
            CHANNELS.hello,
            expect.objectContaining({ isMainFrame: true, contextIsolated: true, sandboxed: true }),
        );
    });

    it('reports window error events until the renderer claims capture', async () => {
        await loadPreload();
        window.dispatchEvent(
            new ErrorEvent('error', { message: 'boom', filename: 'app.js', lineno: 3, colno: 4 }),
        );
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
            CHANNELS.post,
            expect.objectContaining({
                kind: 'crash',
                origin: 'renderer.error',
                error: expect.objectContaining({ message: 'boom' }),
                context: expect.objectContaining({ capture: 'preload', isTopLevel: true }),
            }),
        );
        exposedBridge().claim();
        (ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockClear();
        window.dispatchEvent(new ErrorEvent('error', { message: 'again' }));
        expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    });

    it('does not install fallback capture when main disables it', async () => {
        (ipcRenderer.sendSync as ReturnType<typeof vi.fn>).mockReturnValue(helloResponse(false));
        await loadPreload();
        window.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));
        expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    });

    it('assigns window.__bugsplat directly without context isolation', async () => {
        proc.contextIsolated = false;
        await loadPreload();
        expect(contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
        const bridge = (window as unknown as { __bugsplat: BugSplatBridge }).__bugsplat;
        expect(typeof bridge.post).toBe('function');
    });

    it('stays inert in subframes', async () => {
        proc.isMainFrame = false;
        await loadPreload();
        expect(ipcRenderer.sendSync).not.toHaveBeenCalled();
        expect(contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
    });

    it('still exposes a no-main bridge when main does not answer', async () => {
        (ipcRenderer.sendSync as ReturnType<typeof vi.fn>).mockReturnValue(null);
        await loadPreload();
        expect(exposedBridge().mode).toBe('no-main');
    });

    it('installs only once per world', async () => {
        await loadPreload();
        const { installPreload } = await import('../../src/preload/index');
        installPreload();
        expect(ipcRenderer.sendSync).toHaveBeenCalledTimes(1);
    });
});
