import { describe, expect, it, vi } from 'vitest';
import {
    installIpc,
    trustTopLevelFrames,
    validateIdentityPatch,
    validatePostRequest,
} from '../../src/main/ipc';
import { CHANNELS, PROTOCOL_VERSION } from '../../src/shared/protocol';
import { createTestClient, postedExceptions } from '../helpers/client';

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
    const sender = {
        id: 7,
        getURL: () => 'app://index.html',
        getTitle: () => 'Title',
        getType: () => 'window',
        getOSProcessId: () => 1234,
    };
    const event = (overrides = {}) => ({
        sender,
        senderFrame: { parent: null },
        returnValue: undefined as unknown,
        ...overrides,
    });
    return { ...test, handlers, listeners, contents, dispose, event, ipcMain };
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
