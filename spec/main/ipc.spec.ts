import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    installIpc,
    trustTopLevelFrames,
    validateIdentityPatch,
    validatePostRequest,
} from '../../src/main/ipc';
import { CHANNELS, LIMITS, PROTOCOL_VERSION } from '../../src/shared/protocol';
import { createTestClient, postedExceptions } from '../helpers/client';
import {
    clearDebugIds,
    ID_A,
    ID_B,
    ID_C,
    postedDebugMeta,
    registerDebugId,
} from '../helpers/debug-ids';

type Handler = (event: unknown, payload: unknown) => unknown;

function setup(options = {}) {
    const test = createTestClient(options);
    const handlers = new Map<string, Handler>();
    const listeners = new Map<string, Handler>();
    const contents: Array<{ isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> }> = [];
    const ipcMain = {
        on: vi.fn((channel: string, handler: Handler) => listeners.set(channel, handler)),
        handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
        removeHandler: vi.fn(),
        removeListener: vi.fn(),
    };
    const dispose = installIpc(test.client, test.client.logger, {
        ipcMain: ipcMain as never,
        getAllWebContents: () => contents as never,
    });
    const sender = Object.assign(new EventEmitter(), {
        id: 7,
        getURL: () => 'app://index.html',
        getTitle: () => 'Title',
        getType: () => 'window',
        getOSProcessId: () => 1234,
        isDestroyed: () => false,
    });
    const event = (overrides = {}) => ({
        sender,
        senderFrame: { parent: null },
        returnValue: undefined as unknown,
        ...overrides,
    });
    return { ...test, handlers, listeners, contents, dispose, event, ipcMain, sender };
}

const validRequest = () => ({
    kind: 'crash',
    origin: 'renderer.error',
    error: { name: 'TypeError', message: 'bad', stack: 'TypeError: bad\n    at x (a.js:1:1)' },
    options: { attributes: { page: 'home' } },
    context: {
        href: 'app://index.html',
        visibilityState: 'visible',
        isTopLevel: true,
        capture: 'renderer',
    },
});

const INDEX = 'app://./assets/index-BX3k.js';
const VENDOR = 'app://./assets/vendor-41fe.js';

/** A report whose stacks name `INDEX` (the error) and `VENDOR` (its cause). */
const bundledRequest = (debugIds?: unknown) => ({
    ...validRequest(),
    error: {
        name: 'Error',
        message: 'outer',
        stack: `Error: outer\n    at render (${INDEX}:1:2345)`,
        cause: {
            name: 'TypeError',
            message: 'inner',
            stack: `TypeError: inner\n    at ${VENDOR}:9:1`,
        },
    },
    debugIds,
});

describe('installIpc', () => {
    it('answers hello with config and identity', () => {
        const { listeners, event, logger } = setup({ email: 'e@x.y' });
        const ev = event();
        listeners.get(CHANNELS.hello)!(ev, { protocolVersion: PROTOCOL_VERSION });
        expect(ev.returnValue).toMatchObject({
            protocolVersion: PROTOCOL_VERSION,
            config: {
                database: 'fred',
                application: 'app',
                version: '1.0.0',
                capture: { fallback: true },
            },
            identity: { email: 'e@x.y' },
        });
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('warns on protocol mismatch but still answers', () => {
        const { listeners, event, logger } = setup();
        const ev = event();
        listeners.get(CHANNELS.hello)!(ev, { protocolVersion: 99 });
        expect(ev.returnValue).not.toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(
            '[bugsplat]',
            expect.stringContaining('protocol v99'),
        );
    });

    it('posts renderer reports with sender context and renderer stack', async () => {
        const { handlers, event, lastBody } = setup({ attributes: { plan: 'pro' } });
        const result = (await handlers.get(CHANNELS.post)!(event(), validRequest())) as {
            error: string | null;
        };
        expect(result.error).toBeNull();
        const body = lastBody();
        expect(postedExceptions(body)[0].stack).toBe('TypeError: bad\n    at x (a.js:1:1)');
        expect(JSON.parse(String(body.get('attributes')))).toMatchObject({
            plan: 'pro',
            page: 'home',
            'bugsplat.origin': 'renderer.error',
            'bugsplat.processType': 'renderer',
            'bugsplat.capture': 'renderer',
            'bugsplat.url': 'app://index.html',
            'bugsplat.title': 'Title',
            'bugsplat.webContentsId': '7',
            'bugsplat.pid': '1234',
            'bugsplat.visibilityState': 'visible',
        });
    });

    it("posts the renderer error's cause chain", async () => {
        const { handlers, event, lastBody } = setup();
        const withCause = {
            ...validRequest(),
            error: {
                name: 'TypeError',
                message: 'bad',
                stack: 'TypeError: bad\n    at x (a.js:1:1)',
                cause: {
                    name: 'SyntaxError',
                    message: 'bad json',
                    stack: 'SyntaxError: bad json\n    at parse (a.js:2:2)',
                },
            },
        };
        await handlers.get(CHANNELS.post)!(event(), withCause);
        const [root, linked] = postedExceptions(lastBody());
        expect(root.stack).toBe('TypeError: bad\n    at x (a.js:1:1)');
        expect(linked).toMatchObject({
            parentId: 0,
            source: 'cause',
            type: 'SyntaxError',
            stack: 'SyntaxError: bad json\n    at parse (a.js:2:2)',
        });
    });

    it("adds the renderer's debug IDs to the report as debugMeta", async () => {
        const { handlers, event, lastBody } = setup();
        const result = (await handlers.get(CHANNELS.post)!(
            event(),
            bundledRequest({ [INDEX]: ID_A, [VENDOR]: ID_B }),
        )) as { error: string | null };
        expect(result.error).toBeNull();
        expect(postedDebugMeta(lastBody())).toEqual([
            { file: INDEX, debugId: ID_A },
            { file: VENDOR, debugId: ID_B },
        ]);
    });

    it('posts no debugMeta for a renderer that sends no debug IDs', async () => {
        const { handlers, event, lastBody } = setup();
        await handlers.get(CHANNELS.post)!(event(), bundledRequest());
        expect(Object.keys(JSON.parse(String(lastBody().get('exceptions'))))).toEqual([
            'exceptions',
        ]);
    });

    it('posts the report and the valid debug IDs when some entries are invalid', async () => {
        const { handlers, event, lastBody } = setup();
        const hostile = JSON.parse(
            `{"__proto__":{"polluted":true},"${INDEX}":"abc","${VENDOR}":"${ID_B}","n":1}`,
        ) as unknown;
        const result = (await handlers.get(CHANNELS.post)!(event(), bundledRequest(hostile))) as {
            error: string | null;
        };
        expect(result.error).toBeNull();
        expect(postedDebugMeta(lastBody())).toEqual([{ file: VENDOR, debugId: ID_B }]);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();

        for (const notAnObject of ['abc', 7, [[INDEX, ID_A]], null]) {
            expect(
                (
                    (await handlers.get(CHANNELS.post)!(event(), bundledRequest(notAnObject))) as {
                        error: string | null;
                    }
                ).error,
            ).toBeNull();
            expect(postedDebugMeta(lastBody())).toBeUndefined();
        }
    });

    describe('with debug IDs registered in the main process', () => {
        afterEach(clearDebugIds);

        it("keeps the main process's ID for a file a renderer also names", async () => {
            const MAIN = '/app/dist/main.js';
            registerDebugId(MAIN, ID_A);
            const { handlers, event, lastBody } = setup();
            const request = bundledRequest({ [MAIN]: ID_C, [INDEX]: ID_B });
            request.error.stack += `\n    at handle (${MAIN}:3:4)`;
            await handlers.get(CHANNELS.post)!(event(), request);
            expect(postedDebugMeta(lastBody())).toEqual([
                { file: INDEX, debugId: ID_B },
                { file: MAIN, debugId: ID_A },
            ]);
        });
    });

    it('keeps the debug IDs each page registers until its webContents is destroyed', () => {
        const { listeners, event, client, sender } = setup();
        const register = listeners.get(CHANNELS.debugIds)!;
        expect(client.rendererDebugIds.get(sender as never)).toBeUndefined();

        register(event(), { [INDEX]: ID_A, 'bad.js': 'abc' });
        expect(client.rendererDebugIds.get(sender as never)).toEqual({ [INDEX]: ID_A });

        register(event(), { [INDEX]: ID_A, [VENDOR]: ID_B });
        expect(client.rendererDebugIds.get(sender as never)).toEqual({
            [INDEX]: ID_A,
            [VENDOR]: ID_B,
        });

        register(event({ senderFrame: { parent: {} } }), { 'frame.js': ID_C });
        expect(client.rendererDebugIds.get(sender as never)).toEqual({
            [INDEX]: ID_A,
            [VENDOR]: ID_B,
        });

        register(event(), 'not an object');
        expect(client.rendererDebugIds.get(sender as never)).toEqual({});

        register(event(), { [INDEX]: ID_A });
        sender.emit('destroyed');
        expect(client.rendererDebugIds.get(sender as never)).toBeUndefined();
    });

    it('caps the debug IDs a page registers and ignores senders its trust policy rejects', () => {
        const { listeners, event, client, sender, logger } = setup({ trustSender: () => false });
        listeners.get(CHANNELS.debugIds)!(event(), { [INDEX]: ID_A });
        expect(client.rendererDebugIds.get(sender as never)).toBeUndefined();

        const trusted = setup();
        const many: Record<string, string> = {};
        for (let i = 0; i < LIMITS.debugIdsPerPage + 50; i++) {
            many[`app://./assets/chunk-${i}.js`] = ID_A;
        }
        trusted.listeners.get(CHANNELS.debugIds)!(trusted.event(), many);
        expect(
            Object.keys(trusted.client.rendererDebugIds.get(trusted.sender as never) ?? {}),
        ).toHaveLength(LIMITS.debugIdsPerPage);

        // Hang stacks come from the main frame: a subframe must not replace its debug IDs,
        // even when the app's trust policy lets subframes post.
        const permissive = setup({ trustSender: () => true });
        const register = permissive.listeners.get(CHANNELS.debugIds)!;
        register(permissive.event(), { [INDEX]: ID_A });
        register(permissive.event({ senderFrame: { parent: {} } }), { 'frame.js': ID_C });
        expect(permissive.client.rendererDebugIds.get(permissive.sender as never)).toEqual({
            [INDEX]: ID_A,
        });

        // A sender that cannot be tracked is logged, never thrown from the IPC listener.
        trusted.listeners.get(CHANNELS.debugIds)!({ senderFrame: { parent: null } }, many);
        expect(trusted.logger.error).toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('rejects malformed, untrusted and rate limited requests without posting', async () => {
        const { handlers, event, fetchSpy } = setup();
        const post = handlers.get(CHANNELS.post)!;
        for (const bad of [
            null,
            'string',
            {},
            { kind: 'crash' },
            { kind: 'crash', error: { stack: 1 } },
        ]) {
            expect(await post(event(), bad)).toEqual({ error: 'invalid request', response: null });
        }
        expect(await post(event({ senderFrame: { parent: {} } }), validRequest())).toEqual({
            error: 'untrusted sender',
            response: null,
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        for (let i = 0; i < 5; i++) {
            expect(((await post(event(), validRequest())) as { error: unknown }).error).toBeNull();
        }
        expect(await post(event(), validRequest())).toEqual({
            error: 'rate limited',
            response: null,
        });
    });

    it('applies identity updates from renderers and broadcasts to live contents', async () => {
        const { handlers, event, contents, store } = setup();
        const live = { isDestroyed: () => false, send: vi.fn() };
        const dead = { isDestroyed: () => true, send: vi.fn() };
        contents.push(live, dead);
        await handlers.get(CHANNELS.update)!(event(), { email: 'r@x.y', attributes: { a: 1 } });
        expect(store.get()).toMatchObject({ email: 'r@x.y', attributes: { a: '1' } });
        expect(live.send).toHaveBeenCalledWith(CHANNELS.identity, {
            identity: expect.objectContaining({ email: 'r@x.y' }),
        });
        expect(dead.send).not.toHaveBeenCalled();
        await handlers.get(CHANNELS.update)!(event({ senderFrame: { parent: {} } }), {
            email: 'no',
        });
        expect(store.get().email).toBe('r@x.y');
    });

    it('disposes handlers', () => {
        const { dispose, ipcMain } = setup();
        dispose();
        expect(ipcMain.removeHandler).toHaveBeenCalledWith(CHANNELS.post);
        expect(ipcMain.removeHandler).toHaveBeenCalledWith(CHANNELS.update);
        expect(ipcMain.removeListener).toHaveBeenCalledWith(CHANNELS.hello, expect.any(Function));
        expect(ipcMain.removeListener).toHaveBeenCalledWith(
            CHANNELS.debugIds,
            expect.any(Function),
        );
    });
});

describe('validatePostRequest', () => {
    it('normalizes origins, truncates and sanitizes attachments', () => {
        const request = validatePostRequest({
            kind: 'crash',
            origin: 'main.manual',
            error: { message: 'm', stack: 's'.repeat(40000), name: 5 },
            options: {
                attributes: { ok: 'v', num: 2, obj: {} },
                attachments: [
                    { filename: 'a.txt', data: new Uint8Array([1, 2]) },
                    { filename: 'b.bin', data: 'nope' },
                ],
            },
            context: { capture: 'preload' },
        })!;
        expect(request.origin).toBe('renderer.manual');
        expect(request.error?.name).toBe('Error');
        expect(request.error?.stack.length).toBe(32 * 1024);
        expect(request.options?.attributes).toEqual({ ok: 'v', num: '2' });
        expect(request.options?.attachments).toHaveLength(1);
        expect(request.context).toEqual({
            href: undefined,
            visibilityState: undefined,
            isTopLevel: true,
            capture: 'preload',
        });
    });

    it('keeps valid debug IDs, drops invalid ones and caps how many it keeps', () => {
        const request = (debugIds: unknown) =>
            validatePostRequest({
                kind: 'crash',
                error: { message: 'm', stack: 's' },
                context: {},
                debugIds,
            })!;
        expect(request({ 'a.js': ID_A, 'b.js': 5, 'c.js': 'abc', '': ID_B }).debugIds).toEqual({
            'a.js': ID_A,
        });
        for (const invalid of [undefined, null, 'a.js', 1, [ID_A], { 'a.js': 'abc' }, {}]) {
            expect(request(invalid).debugIds).toBeUndefined();
        }
        const many: Record<string, string> = {};
        for (let i = 0; i < LIMITS.debugIdsPerReport + 50; i++) {
            many[`chunk-${i}.js`] = ID_A;
        }
        expect(Object.keys(request(many).debugIds ?? {})).toHaveLength(LIMITS.debugIdsPerReport);
    });

    it('requires a title for feedback', () => {
        expect(validatePostRequest({ kind: 'feedback', context: {} })).toBeNull();
        expect(validatePostRequest({ kind: 'feedback', title: 'T', context: {} })?.origin).toBe(
            'renderer.feedback',
        );
    });
});

describe('validateIdentityPatch', () => {
    it('keeps only known fields and string-ish attributes', () => {
        expect(
            validateIdentityPatch({
                email: 'e',
                bogus: 'x',
                attributes: { a: 'x', b: null, c: true, d: {} },
                replaceAttributes: true,
            }),
        ).toEqual({
            email: 'e',
            attributes: { a: 'x', b: null, c: 'true' },
            replaceAttributes: true,
        });
        expect(validateIdentityPatch('nope')).toBeNull();
    });
});

describe('trustTopLevelFrames', () => {
    it('trusts only top-level frames', () => {
        expect(trustTopLevelFrames({ senderFrame: { parent: null } } as never)).toBe(true);
        expect(trustTopLevelFrames({ senderFrame: { parent: {} } } as never)).toBe(false);
        expect(trustTopLevelFrames({ senderFrame: null } as never)).toBe(false);
    });
});
