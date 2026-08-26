import { describe, expect, it, vi } from 'vitest';
import { createBridge } from '../../src/shared/bridge';
import { emptyIdentity } from '../../src/shared/identity';
import { CHANNELS, PROTOCOL_VERSION, type HelloResponse } from '../../src/shared/protocol';

function fakeIpc(helloResponse: HelloResponse | null) {
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>();
    return {
        ipc: {
            sendSync: vi.fn(() => helloResponse),
            invoke: vi.fn(async () => ({ error: null, response: { crash_id: 1 } })),
            on: vi.fn((channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
                listeners.set(channel, listener);
            }),
        },
        emit: (channel: string, payload: unknown) => listeners.get(channel)?.({}, payload),
    };
}

const hello = (): HelloResponse => ({
    protocolVersion: PROTOCOL_VERSION,
    config: {
        database: 'fred',
        application: 'app',
        version: '1',
        sdkVersion: 'x',
        capture: { errors: true, unhandledRejections: true, fallback: true, includeUrl: true },
    },
    identity: { ...emptyIdentity(), seq: 3, email: 'a@b.c', attributes: { plan: 'pro' } },
});

const deps = () => ({
    isMainFrame: true,
    contextIsolated: true,
    sandboxed: true,
    sdkVersion: 'x',
});

describe('createBridge', () => {
    it('performs a sync hello and applies crash keys before returning', () => {
        const { ipc } = fakeIpc(hello());
        const crashReporter = { addExtraParameter: vi.fn(), removeExtraParameter: vi.fn() };
        const bridge = createBridge({ ...deps(), ipcRenderer: ipc, crashReporter });
        expect(ipc.sendSync).toHaveBeenCalledWith(
            CHANNELS.hello,
            expect.objectContaining({ protocolVersion: PROTOCOL_VERSION, isMainFrame: true }),
        );
        expect(bridge.mode).toBe('main');
        expect(bridge.getConfig()?.database).toBe('fred');
        expect(bridge.getIdentity()?.email).toBe('a@b.c');
        expect(crashReporter.addExtraParameter).toHaveBeenCalledWith('email', 'a@b.c');
        expect(crashReporter.addExtraParameter).toHaveBeenCalledWith('plan', 'pro');
    });

    it('applies identity broadcasts by seq and diffs crash keys', () => {
        const { ipc, emit } = fakeIpc(hello());
        const crashReporter = { addExtraParameter: vi.fn(), removeExtraParameter: vi.fn() };
        const bridge = createBridge({ ...deps(), ipcRenderer: ipc, crashReporter });
        const seen: number[] = [];
        bridge.onIdentity((s) => seen.push(s.seq));
        crashReporter.addExtraParameter.mockClear();

        emit(CHANNELS.identity, { identity: { ...emptyIdentity(), seq: 2, email: 'old' } });
        expect(crashReporter.addExtraParameter).not.toHaveBeenCalled();

        emit(CHANNELS.identity, { identity: { ...emptyIdentity(), seq: 4, email: 'new@x.y' } });
        expect(crashReporter.addExtraParameter).toHaveBeenCalledWith('email', 'new@x.y');
        expect(crashReporter.removeExtraParameter).toHaveBeenCalledWith('plan');
        expect(seen).toEqual([4]);
        expect(bridge.getIdentity()?.seq).toBe(4);
    });

    it('reports no-main when the hello is unanswered and upgrades on a later broadcast', () => {
        const { ipc, emit } = fakeIpc(null);
        const bridge = createBridge({ ...deps(), ipcRenderer: ipc, crashReporter: null });
        expect(bridge.mode).toBe('no-main');
        expect(bridge.getConfig()).toBeNull();
        emit(CHANNELS.identity, { identity: { ...emptyIdentity(), seq: 1 } });
        expect(bridge.getMode()).toBe('main');
    });

    it('survives a throwing hello', () => {
        const { ipc } = fakeIpc(null);
        ipc.sendSync.mockImplementation(() => {
            throw new Error('no listener');
        });
        const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const bridge = createBridge({ ...deps(), ipcRenderer: ipc, logger });
        expect(bridge.mode).toBe('no-main');
        expect(logger.warn).toHaveBeenCalled();
    });

    it('posts and updates over invoke and maps failures', async () => {
        const { ipc } = fakeIpc(hello());
        const onClaim = vi.fn();
        const bridge = createBridge({ ...deps(), ipcRenderer: ipc, onClaim });
        const request = {
            kind: 'crash' as const,
            origin: 'renderer.manual' as const,
            error: { name: 'Error', message: 'm', stack: 's' },
            context: { isTopLevel: true, capture: 'renderer' as const },
        };
        expect(await bridge.post(request)).toEqual({ error: null, response: { crash_id: 1 } });
        expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.post, request);

        ipc.invoke.mockRejectedValueOnce(new Error('ipc down'));
        expect(await bridge.post(request)).toEqual({ error: 'ipc down', response: null });

        ipc.invoke.mockResolvedValueOnce(undefined as never);
        expect((await bridge.post(request)).error).toContain('no response');

        await bridge.update({ email: 'z' });
        expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.update, { email: 'z' });

        bridge.claim();
        expect(onClaim).toHaveBeenCalled();
    });
});
