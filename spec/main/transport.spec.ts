import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, net, session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
    createFetch,
    injectFetch,
    NET_TRANSPORT_PARTITION,
    readFileAttachments,
} from '../../src/main/transport';
import type { Logger } from '../../src/shared/logger';

const logger = (): Logger => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('createFetch', () => {
    it('uses the global fetch for "node"', async () => {
        const spy = vi.fn(async () => new Response('ok'));
        vi.stubGlobal('fetch', spy);
        await createFetch('node')('https://x', { method: 'POST' });
        expect(spy).toHaveBeenCalledWith('https://x', { method: 'POST' });
        vi.unstubAllGlobals();
    });

    // __mocks__/electron.ts exports its FakeSession on `session`; Electron's own types don't.
    const { FakeSession } = session as unknown as {
        FakeSession: new () => { fetch: ReturnType<typeof vi.fn> };
    };
    const fakeTransportSession = () => {
        const ses = new FakeSession();
        vi.mocked(session.fromPartition).mockReturnValue(ses as never);
        return ses;
    };

    it('posts from an in-memory session for "net" only once the app is ready', async () => {
        const nodeSpy = vi.fn(async () => new Response('node'));
        vi.stubGlobal('fetch', nodeSpy);
        const ses = fakeTransportSession();
        ses.fetch.mockResolvedValue(new Response('net'));
        const fetchImpl = createFetch('net');
        expect(await (await fetchImpl('https://x')).text()).toBe('node');
        expect(session.fromPartition).not.toHaveBeenCalled();
        (app.isReady as ReturnType<typeof vi.fn>).mockReturnValue(true);
        expect(await (await fetchImpl('https://x')).text()).toBe('net');
        await fetchImpl('https://x/again');
        // One non-persistent partition (no "persist:" prefix, no HTTP cache), created once.
        expect(session.fromPartition).toHaveBeenCalledTimes(1);
        expect(session.fromPartition).toHaveBeenCalledWith(NET_TRANSPORT_PARTITION, {
            cache: false,
        });
        expect(NET_TRANSPORT_PARTITION.startsWith('persist:')).toBe(false);
        expect(net.fetch).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('forwards a Request unchanged and turns a URL into its href', async () => {
        (app.isReady as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const ses = fakeTransportSession();
        ses.fetch.mockResolvedValue(new Response('net'));
        const fetchImpl = createFetch('net');
        const request = new Request('https://x/post', { method: 'POST' });
        await fetchImpl(request);
        expect(ses.fetch).toHaveBeenLastCalledWith(request, undefined);
        await fetchImpl(new URL('https://x/url'));
        expect(ses.fetch).toHaveBeenLastCalledWith('https://x/url', undefined);
    });

    it('falls back to net.fetch when the session cannot fetch', async () => {
        (app.isReady as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const ses = fakeTransportSession() as unknown as { fetch?: unknown };
        delete ses.fetch;
        (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('net'));
        expect(await (await createFetch('net')('https://x')).text()).toBe('net');
    });

    it('passes custom fetch through and injects into bugsplat', () => {
        const custom = vi.fn();
        expect(createFetch(custom as unknown as typeof fetch)).toBe(custom);
        const client = {} as { _fetch?: unknown };
        injectFetch(client as never, custom as unknown as typeof fetch);
        expect(client._fetch).toBe(custom);
    });
});

describe('readFileAttachments', () => {
    it('reads files, skips missing ones and enforces the size cap', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bugsplat-'));
        writeFileSync(join(dir, 'a.txt'), 'aaaa');
        writeFileSync(join(dir, 'b.txt'), 'bbbbbbbb');
        const log = logger();
        const attachments = await readFileAttachments(
            [join(dir, 'a.txt'), join(dir, 'missing.txt'), join(dir, 'b.txt')],
            log,
            6,
        );
        expect(attachments.map((a) => a.filename)).toEqual(['a.txt']);
        expect(log.warn).toHaveBeenCalledTimes(2);
    });
});
