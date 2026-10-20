import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, net } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createFetch, injectFetch, readFileAttachments } from '../../src/main/transport';
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

    it('uses net.fetch for "net" only once the app is ready', async () => {
        const nodeSpy = vi.fn(async () => new Response('node'));
        vi.stubGlobal('fetch', nodeSpy);
        (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('net'));
        const fetchImpl = createFetch('net');
        expect(await (await fetchImpl('https://x')).text()).toBe('node');
        (app.isReady as ReturnType<typeof vi.fn>).mockReturnValue(true);
        expect(await (await fetchImpl('https://x')).text()).toBe('net');
        vi.unstubAllGlobals();
    });

    it('forwards a Request to net.fetch and turns a URL into its href', async () => {
        (app.isReady as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const netFetch = net.fetch as ReturnType<typeof vi.fn>;
        netFetch.mockResolvedValue(new Response('net'));
        const fetchImpl = createFetch('net');
        const request = new Request('https://x/post', { method: 'POST' });
        await fetchImpl(request);
        expect(netFetch).toHaveBeenLastCalledWith(request, undefined);
        await fetchImpl(new URL('https://x/url'));
        expect(netFetch).toHaveBeenLastCalledWith('https://x/url', undefined);
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
