// @vitest-environment happy-dom
import type { BugSplat } from 'bugsplat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BugSplatRenderer, getClient, init, post, setAttribute } from '../../src/renderer/index';
import { DEBUG_ID_SYNC_INTERVAL_MS } from '../../src/renderer/debug-ids';
import { emptyIdentity } from '../../src/shared/identity';
import { LIMITS, type BugSplatBridge, type PostRequest } from '../../src/shared/protocol';
import { clearDebugIds, ID_A, ID_B, ID_C, registerDebugId } from '../helpers/debug-ids';

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
        setDebugIds: vi.fn(),
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

    describe('source map debug IDs', () => {
        const INDEX = 'app://./assets/index-BX3k.js';
        const VENDOR = 'app://./assets/vendor-41fe.js';
        const UNUSED = 'app://./assets/settings-9c2d.js';
        const lastRequest = (): PostRequest =>
            (bridge.post as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as PostRequest;
        const thrownIn = (file: string, cause?: Error): Error => {
            const error = new Error(`thrown in ${file}`, { cause });
            error.stack = `Error: thrown in ${file}\n    at render (${file}:1:2345)`;
            return error;
        };

        afterEach(clearDebugIds);

        it('sends the debug IDs of the files in a captured error and its causes', async () => {
            registerDebugId(INDEX, ID_A);
            registerDebugId(VENDOR, ID_B);
            registerDebugId(UNUSED, ID_C);
            init();
            window.dispatchEvent(
                new ErrorEvent('error', { error: thrownIn(INDEX, thrownIn(VENDOR)) }),
            );
            await Promise.resolve();
            expect(lastRequest().debugIds).toEqual({ [INDEX]: ID_A, [VENDOR]: ID_B });

            window.dispatchEvent(
                Object.assign(new Event('unhandledrejection'), { reason: thrownIn(UNUSED) }),
            );
            await Promise.resolve();
            expect(lastRequest().debugIds).toEqual({ [UNUSED]: ID_C });
        });

        it('sends no debugIds field when no file in the stack has a debug ID', async () => {
            init();
            await post(thrownIn(INDEX));
            expect('debugIds' in lastRequest()).toBe(false);

            registerDebugId(UNUSED, ID_C);
            await post(thrownIn(INDEX));
            expect('debugIds' in lastRequest()).toBe(false);

            await getClient()!.postFeedback('Feedback');
            expect('debugIds' in lastRequest()).toBe(false);
        });

        it('lets the debugIds option of post() add to and override the page registry', async () => {
            registerDebugId(INDEX, ID_A);
            const client = init();
            await client.post(thrownIn(INDEX, thrownIn(VENDOR)), {
                debugIds: { [INDEX]: ID_C, [VENDOR]: ID_B, [UNUSED]: ID_A, 'bad.js': 'abc' },
            });
            expect(lastRequest().debugIds).toEqual({ [INDEX]: ID_C, [VENDOR]: ID_B });
            expect('debugIds' in (lastRequest().options ?? {})).toBe(false);
        });

        it('posts through a bridge from a preload that has no setDebugIds', async () => {
            registerDebugId(INDEX, ID_A);
            delete bridge.setDebugIds;
            const client = init();
            expect((await client.post(thrownIn(INDEX))).error).toBeNull();
            expect(lastRequest().debugIds).toEqual({ [INDEX]: ID_A });
        });

        describe('registration with the main process', () => {
            beforeEach(() => {
                vi.useFakeTimers();
            });

            afterEach(() => {
                vi.useRealTimers();
            });

            it('registers nothing while no script has a debug ID', () => {
                init();
                vi.advanceTimersByTime(10_000);
                expect(bridge.setDebugIds).not.toHaveBeenCalled();
            });

            it('registers at init, after the calling script finishes, and when chunks load', () => {
                registerDebugId(VENDOR, ID_B);
                init();
                expect(bridge.setDebugIds).toHaveBeenCalledTimes(1);
                expect(bridge.setDebugIds).toHaveBeenLastCalledWith({ [VENDOR]: ID_B });

                // The script that called init() registers itself on its last line.
                registerDebugId(INDEX, ID_A);
                vi.advanceTimersByTime(0);
                expect(bridge.setDebugIds).toHaveBeenCalledTimes(2);
                expect(bridge.setDebugIds).toHaveBeenLastCalledWith({
                    [VENDOR]: ID_B,
                    [INDEX]: ID_A,
                });

                vi.advanceTimersByTime(60_000);
                expect(bridge.setDebugIds).toHaveBeenCalledTimes(2);

                // Two lazily loaded chunks between checks cost one message.
                registerDebugId(UNUSED, ID_C);
                registerDebugId('app://./assets/chart-77aa.js', ID_C);
                vi.advanceTimersByTime(DEBUG_ID_SYNC_INTERVAL_MS);
                expect(bridge.setDebugIds).toHaveBeenCalledTimes(3);
                expect(bridge.setDebugIds).toHaveBeenLastCalledWith({
                    [VENDOR]: ID_B,
                    [INDEX]: ID_A,
                    [UNUSED]: ID_C,
                    'app://./assets/chart-77aa.js': ID_C,
                });
            });

            it('caps how many debug IDs it registers', () => {
                for (let i = 0; i < LIMITS.debugIdsPerPage + 10; i++) {
                    registerDebugId(`app://./assets/chunk-${i}.js`, ID_A);
                }
                init();
                const sent = (bridge.setDebugIds as ReturnType<typeof vi.fn>).mock.calls[0][0];
                expect(Object.keys(sent as object)).toHaveLength(LIMITS.debugIdsPerPage);
            });
        });
    });

    it('is compatible with @bugsplat/react ErrorBoundary scopes', async () => {
        const scope: { getClient(): BugSplat | null } = { getClient };
        init();
        expect(scope.getClient()).toBeInstanceOf(BugSplatRenderer);
        await post(new Error('via module post'));
        expect(bridge.post).toHaveBeenCalled();
    });
});
