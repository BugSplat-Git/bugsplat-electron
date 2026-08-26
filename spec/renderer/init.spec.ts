// @vitest-environment happy-dom
import type { BugSplat } from 'bugsplat';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BugSplatRenderer, getClient, init, post, setAttribute } from '../../src/renderer/index';
import { emptyIdentity } from '../../src/shared/identity';
import type { BugSplatBridge } from '../../src/shared/protocol';

function fakeBridge(overrides: Partial<BugSplatBridge> = {}): BugSplatBridge {
    const listeners = new Set<(s: never) => void>();
    return {
        protocolVersion: 1,
        mode: 'main',
        getMode: () => 'main',
        getConfig: () => ({
            database: 'fred',
            application: 'app',
            version: '2.0.0',
            sdkVersion: 'x',
            capture: { errors: true, unhandledRejections: true, fallback: true, includeUrl: true },
        }),
        getIdentity: () => ({ ...emptyIdentity(), seq: 1, email: 'main@x.y' }),
        onIdentity: vi.fn((listener) => {
            listeners.add(listener as never);
            return () => listeners.delete(listener as never);
        }),
        post: vi.fn(async () => ({ error: null, response: { crash_id: 5 } })),
        update: vi.fn(async () => undefined),
        claim: vi.fn(),
        ...overrides,
    };
}

const win = window as unknown as Record<string, unknown>;

describe('renderer init (bridge mode)', () => {
    let bridge: BugSplatBridge;

    beforeEach(() => {
        delete win.__bugsplatRendererClient;
        bridge = fakeBridge();
        win.__bugsplat = bridge;
    });

    it('uses the bridge config and claims capture', () => {
        const client = init();
        expect(client.mode).toBe('bridge');
        expect(client.database).toBe('fred');
        expect(client.version).toBe('2.0.0');
        expect(client.getIdentity()?.email).toBe('main@x.y');
        expect(bridge.claim).toHaveBeenCalled();
        expect(getClient()).toBe(client);
        expect(init()).toBe(client);
    });

    it('reports window error and unhandledrejection events through the bridge', async () => {
        init();
        window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('boom') }));
        await Promise.resolve();
        expect(bridge.post).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'crash',
                origin: 'renderer.error',
                error: expect.objectContaining({ name: 'TypeError', message: 'boom' }),
                context: expect.objectContaining({ capture: 'renderer', isTopLevel: true }),
            }),
        );
        window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'nope' }));
        expect(bridge.post).toHaveBeenLastCalledWith(
            expect.objectContaining({
                origin: 'renderer.unhandledrejection',
                error: expect.objectContaining({ message: 'nope' }),
            }),
        );
    });

    it('honours capture toggles', () => {
        init({ captureErrors: false, captureUnhandledRejections: false });
        window.dispatchEvent(new ErrorEvent('error', { error: new Error('x') }));
        expect(bridge.post).not.toHaveBeenCalled();
    });

    it('posts manually with serialized options and maps the result', async () => {
        const client = init();
        const blob = new Blob(['component stack'], { type: 'text/plain' });
        const result = await client.post(new Error('manual'), {
            attributes: { a: '1' },
            attachments: [{ filename: 'componentStack.txt', data: blob }],
        });
        expect(result.error).toBeNull();
        expect(result.response).toEqual({ crash_id: 5 });
        const request = (bridge.post as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(request.origin).toBe('renderer.manual');
        expect(request.options.attributes).toEqual({ a: '1' });
        expect(request.options.attachments[0].filename).toBe('componentStack.txt');
        expect(new TextDecoder().decode(request.options.attachments[0].data)).toBe(
            'component stack',
        );
        expect(request.context.href).toBe(window.location.href);
    });

    it('turns bridge errors into { error } and never rejects', async () => {
        (bridge.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            error: 'rate limited',
            response: null,
        });
        const client = init();
        const result = await client.post('x');
        expect(result.error?.message).toBe('BugSplat Error: rate limited');
        (bridge.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('kaboom'));
        expect((await client.post('y')).error?.message).toContain('kaboom');
    });

    it('routes identity setters to the main process', () => {
        const client = init({ attributes: { page: 'home' } });
        expect(bridge.update).toHaveBeenCalledWith({ attributes: { page: 'home' } });
        client.setUser('u');
        client.setDefaultEmail('e');
        client.setDefaultAttributes({ z: '1' });
        client.removeAttribute('z');
        setAttribute('k', 'v');
        expect(bridge.update).toHaveBeenCalledWith({ user: 'u' });
        expect(bridge.update).toHaveBeenCalledWith({ email: 'e' });
        expect(bridge.update).toHaveBeenCalledWith({
            attributes: { z: '1' },
            replaceAttributes: true,
        });
        expect(bridge.update).toHaveBeenCalledWith({ attributes: { z: null } });
        expect(bridge.update).toHaveBeenCalledWith({ attributes: { k: 'v' } });
    });

    it('is compatible with @bugsplat/react ErrorBoundary scopes', async () => {
        const scope: { getClient(): BugSplat | null } = { getClient };
        init();
        expect(scope.getClient()).toBeInstanceOf(BugSplatRenderer);
        await post(new Error('via module post'));
        expect(bridge.post).toHaveBeenCalled();
    });
});
