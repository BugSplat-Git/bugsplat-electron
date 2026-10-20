// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../../src/renderer/index';
import { CHANNELS } from '../../src/shared/protocol';

const win = window as unknown as Record<string, unknown>;

const okResponse = (): Response =>
    new Response(
        JSON.stringify({ status: 'success', current_server_time: 1, message: 'ok', crash_id: 9 }),
        { status: 200 },
    );

const postedBody = (fetchSpy: ReturnType<typeof vi.fn>): FormData =>
    (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;

describe('renderer init without a preload bridge', () => {
    beforeEach(() => {
        delete win.__bugsplatRendererClient;
        delete win.__bugsplat;
        delete win.require;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('falls back to direct HTTP posts when given a database', async () => {
        const fetchSpy = vi.fn(async () => okResponse());
        vi.stubGlobal('fetch', fetchSpy);
        const client = init({ database: 'fred', application: 'app', version: '1', logger: null });
        expect(client.mode).toBe('http');
        client.setUser('local');
        const result = await client.post(new Error('direct'));
        expect(result.error).toBeNull();
        expect(fetchSpy).toHaveBeenCalledWith(
            'https://fred.bugsplat.com/post/js/',
            expect.anything(),
        );
        const body = postedBody(fetchSpy);
        expect(body.get('appName')).toBe('app');
        expect(body.get('user')).toBe('local');
    });

    it('posts captured errors over HTTP with their own stack and cause chain', async () => {
        const fetchSpy = vi.fn(async () => okResponse());
        vi.stubGlobal('fetch', fetchSpy);
        const client = init({ database: 'fred', logger: null });
        await client.reportSerialized(
            {
                name: 'TypeError',
                message: 'outer',
                stack: 'TypeError: outer\n    at page (app.js:1:1)',
                cause: {
                    name: 'SyntaxError',
                    message: 'inner',
                    stack: 'SyntaxError: inner\n    at parse (app.js:2:2)',
                },
            },
            'renderer.error',
        );
        const { exceptions } = JSON.parse(String(postedBody(fetchSpy).get('exceptions'))) as {
            exceptions: Array<{
                parentId: number | null;
                source: string | null;
                type: string;
                stack?: string;
            }>;
        };
        expect(exceptions[0]).toMatchObject({
            type: 'TypeError',
            stack: 'TypeError: outer\n    at page (app.js:1:1)',
        });
        expect(exceptions[1]).toMatchObject({
            parentId: 0,
            source: 'cause',
            type: 'SyntaxError',
            stack: 'SyntaxError: inner\n    at parse (app.js:2:2)',
        });
    });

    it('never rejects when the network fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('offline');
            }),
        );
        const client = init({ database: 'fred', logger: null });
        expect((await client.post('x')).error?.message).toContain('offline');
    });

    it('warns and fails posts when neither bridge nor database exist', async () => {
        const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const client = init({ logger });
        expect(logger.warn).toHaveBeenCalledWith(
            '[bugsplat renderer]',
            expect.stringContaining('no preload bridge'),
        );
        expect((await client.post('x')).error?.message).toContain('no bridge');
    });

    it('uses ipcRenderer directly when node integration exposes require()', () => {
        const ipcRenderer = {
            sendSync: vi.fn(() => ({
                protocolVersion: 1,
                config: {
                    database: 'db',
                    application: 'a',
                    version: 'v',
                    sdkVersion: 'x',
                    capture: {
                        errors: true,
                        unhandledRejections: true,
                        fallback: false,
                        includeUrl: true,
                    },
                },
                identity: {
                    seq: 1,
                    appKey: '',
                    user: '',
                    email: 'ipc@x.y',
                    description: '',
                    notes: '',
                    attributes: {},
                },
            })),
            invoke: vi.fn(async () => ({ error: null, response: {} })),
            on: vi.fn(),
        };
        const crashReporter = { addExtraParameter: vi.fn(), removeExtraParameter: vi.fn() };
        win.require = (id: string) => (id === 'electron' ? { ipcRenderer, crashReporter } : {});
        const client = init({ logger: null });
        expect(client.mode).toBe('ipc');
        expect(client.database).toBe('db');
        expect(ipcRenderer.sendSync).toHaveBeenCalledWith(CHANNELS.hello, expect.anything());
        expect(crashReporter.addExtraParameter).toHaveBeenCalledWith('email', 'ipc@x.y');
    });
});
