import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createTestClient, okResponse } from '../helpers/client';

describe('BugSplatElectron', () => {
    it('posts with merged identity, notes and context attributes', async () => {
        const { client, lastBody, lastUrl } = createTestClient({
            appKey: 'key',
            user: 'Fred',
            email: 'fred@bugsplat.com',
            description: 'desc',
            notes: 'some notes',
            attributes: { plan: 'pro' },
        });
        const result = await client.post(new Error('boom'), { attributes: { extra: '1' } });
        expect(result.error).toBeNull();
        expect(lastUrl()).toBe('https://fred.bugsplat.com/post/js/');
        const body = lastBody();
        expect(body.get('database')).toBe('fred');
        expect(body.get('appName')).toBe('app');
        expect(body.get('appVersion')).toBe('1.0.0');
        expect(body.get('appKey')).toBe('key');
        expect(body.get('user')).toBe('Fred');
        expect(body.get('email')).toBe('fred@bugsplat.com');
        expect(body.get('description')).toBe('desc');
        expect(String(body.get('callstack'))).toContain('Error: boom');
        expect(JSON.parse(String(body.get('attributes')))).toEqual({
            plan: 'pro',
            notes: 'some notes',
            'bugsplat.sdk': '@bugsplat/electron/0.0.0-test',
            'bugsplat.origin': 'main.manual',
            'bugsplat.processType': 'browser',
            extra: '1',
        });
    });

    it('lets per-call options override identity', async () => {
        const { client, lastBody } = createTestClient({ email: 'a@b.c', user: 'u' });
        await client.post('text error', { email: 'override@x.y' });
        expect(lastBody().get('email')).toBe('override@x.y');
        expect(lastBody().get('user')).toBe('u');
        expect(String(lastBody().get('callstack'))).toContain('Error: text error');
    });

    it('routes setters through the identity store', () => {
        const { client, store } = createTestClient();
        const seen: string[] = [];
        store.subscribe((s) => seen.push(`${s.seq}:${s.email}:${s.attributes.a ?? ''}`));
        client.setEmail('e@x.y');
        client.setDefaultUser('u');
        client.setAttribute('a', '1');
        client.setDefaultAttributes({ b: '2' });
        client.removeAttribute('b');
        expect(seen).toEqual(['1:e@x.y:', '2:e@x.y:', '3:e@x.y:1', '4:e@x.y:', '5:e@x.y:']);
        expect(client.getIdentity()).toMatchObject({ email: 'e@x.y', user: 'u', attributes: {} });
    });

    it('resolves { error } instead of rejecting on network failure', async () => {
        const { client } = createTestClient({}, async () => {
            throw new Error('offline');
        });
        const result = await client.post(new Error('x'));
        expect(result.error?.message).toContain('offline');
        expect(result.response).toBeNull();
    });

    it('resolves { error } on HTTP failure', async () => {
        const { client } = createTestClient({}, async () => new Response('bad', { status: 500 }));
        const result = await client.post(new Error('x'));
        expect(result.error?.message).toBe('BugSplat Error: Unknown error');
    });

    it('is disabled without a database', async () => {
        const { client, fetchSpy } = createTestClient({ database: '' });
        expect(client.enabled).toBe(false);
        const result = await client.post(new Error('x'));
        expect(result.error?.message).toContain('disabled');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('runs beforePost and can drop or modify reports', async () => {
        const beforePost = vi.fn((report) => {
            if (report.error?.message === 'drop') {
                return null;
            }
            report.options.attributes = { ...report.options.attributes, hooked: 'yes' };
            return report;
        });
        const { client, fetchSpy, lastBody } = createTestClient({ beforePost });
        const dropped = await client.post(new Error('drop'));
        expect(dropped.error?.message).toContain('beforePost');
        expect(fetchSpy).not.toHaveBeenCalled();
        await client.post(new Error('keep'));
        expect(JSON.parse(String(lastBody().get('attributes'))).hooked).toBe('yes');
    });

    it('posts feedback with the same identity', async () => {
        const { client, lastBody, lastUrl } = createTestClient({ user: 'u' });
        await client.postFeedback('Title');
        expect(lastUrl()).toBe('https://fred.bugsplat.com/post/feedback/');
        expect(lastBody().get('title')).toBe('Title');
        expect(lastBody().get('user')).toBe('u');
    });

    it('attaches additionalFilePaths and skips missing files', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bugsplat-'));
        const file = join(dir, 'log.txt');
        writeFileSync(file, 'hello');
        const { client, lastBody, logger } = createTestClient({
            additionalFilePaths: [file, join(dir, 'missing.txt')],
        });
        await client.post(new Error('x'));
        const part = lastBody().get('log.txt') as Blob;
        expect(part).toBeInstanceOf(Blob);
        expect(await part.text()).toBe('hello');
        expect(lastBody().get('missing.txt')).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(
            '[bugsplat]',
            expect.stringContaining('missing.txt'),
        );
    });

    it('report() lets internal callers add context attributes and skip default files', async () => {
        const { client, lastBody } = createTestClient({ attributes: { a: '1' } });
        await client.report({
            kind: 'crash',
            origin: 'renderer.error',
            error: new Error('r'),
            contextAttributes: { 'bugsplat.processType': 'renderer', 'bugsplat.url': 'app://x' },
            skipDefaultFiles: true,
        });
        expect(JSON.parse(String(lastBody().get('attributes')))).toMatchObject({
            a: '1',
            'bugsplat.origin': 'renderer.error',
            'bugsplat.processType': 'renderer',
            'bugsplat.url': 'app://x',
        });
    });

    it('validates responses', async () => {
        const { client } = createTestClient({}, async () => okResponse({ crash_id: 'nope' }));
        const result = await client.post(new Error('x'));
        expect(result.error?.message).toBe('BugSplat Error: Invalid response received');
    });
});
