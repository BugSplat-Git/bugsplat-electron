import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
    NOT_OPTED_IN_PREFIX,
    buildHangError,
    collectStack,
    formatCollectedStack,
    installUnresponsive,
} from '../../src/main/signals/unresponsive';
import { createTestClient } from '../helpers/client';
import { ID_A, ID_B, postedDebugMeta } from '../helpers/debug-ids';

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('collectStack', () => {
    it('maps every outcome to a status', async () => {
        expect(await collectStack(null, 10)).toEqual({ status: 'unsupported' });
        expect(await collectStack({}, 10)).toEqual({ status: 'unsupported' });
        expect(
            await collectStack({ collectJavaScriptCallStack: async () => 'at foo (a.js:1:1)' }, 10),
        ).toEqual({ status: 'collected', stack: 'at foo (a.js:1:1)' });
        expect(
            await collectStack(
                { collectJavaScriptCallStack: () => new Promise(() => undefined) },
                10,
            ),
        ).toEqual({
            status: 'timeout',
        });
        expect(
            await collectStack({ collectJavaScriptCallStack: async () => undefined }, 10),
        ).toEqual({
            status: 'unavailable',
        });
        expect(
            await collectStack(
                {
                    collectJavaScriptCallStack: async () =>
                        `${NOT_OPTED_IN_PREFIX} for JS call stacks in crash reports`,
                },
                10,
            ),
        ).toEqual({ status: 'not-opted-in' });
        expect(
            await collectStack(
                {
                    collectJavaScriptCallStack: async () => {
                        throw new Error('gone');
                    },
                },
                10,
            ),
        ).toEqual({ status: 'unavailable' });
    });
});

describe('formatCollectedStack / buildHangError', () => {
    it('normalizes frames and groups hangs without stacks by status', () => {
        expect(formatCollectedStack('at a (x.js:1:1)\n  b (y.js:2:2)\n\n')).toBe(
            '    at a (x.js:1:1)\n    at b (y.js:2:2)',
        );
        const withStack = buildHangError('Renderer unresponsive: T', {
            status: 'collected',
            stack: 'at hot (x.js:1:1)',
        });
        expect(withStack.name).toBe('RendererUnresponsive');
        expect(withStack.stack).toBe(
            'RendererUnresponsive: Renderer unresponsive: T\n    at hot (x.js:1:1)',
        );
        const without = buildHangError('Renderer unresponsive: T', { status: 'timeout' });
        expect(without.stack).toBe(
            'RendererUnresponsive: Renderer unresponsive: T\n    at unresponsive.timeout (electron)',
        );
    });
});

function fakeContents(stack: () => Promise<string | void>) {
    return Object.assign(new EventEmitter(), {
        id: 9,
        isDestroyed: () => false,
        getURL: () => 'app://page',
        getTitle: () => 'Page',
        getType: () => 'window',
        mainFrame: { collectJavaScriptCallStack: stack },
    });
}

function setup(overrides = {}, contents = fakeContents(async () => 'at hot (x.js:1:1)')) {
    const test = createTestClient();
    const report = vi
        .spyOn(test.client, 'report')
        .mockResolvedValue({ error: null, response: null, original: '' } as never);
    const app = new EventEmitter();
    let now = 0;
    installUnresponsive(
        test.client,
        {
            collectStack: true,
            stackTimeoutMs: 10,
            enableFeature: true,
            injectDocumentPolicyHeader: false,
            reportWithoutStack: true,
            ...overrides,
        },
        test.client.logger,
        {
            app: app as never,
            existing: () => [contents as never],
            isVisible: () => true,
            now: () => now,
        },
    );
    return { ...test, report, app, contents, advance: (ms: number) => (now += ms) };
}

describe('installUnresponsive', () => {
    it('reports a hang with the collected JS stack and dedupes until responsive', async () => {
        const { contents, report, advance } = setup();
        contents.emit('unresponsive');
        contents.emit('unresponsive');
        await flush();
        expect(report).toHaveBeenCalledTimes(1);
        const input = report.mock.calls[0][0];
        expect(input.origin).toBe('unresponsive');
        expect(input.error?.stack).toBe(
            'RendererUnresponsive: Renderer unresponsive: Page\n    at hot (x.js:1:1)',
        );
        expect(input.contextAttributes).toMatchObject({
            'bugsplat.reason': 'unresponsive',
            'bugsplat.stackStatus': 'collected',
            'bugsplat.url': 'app://page',
            'bugsplat.webContentsId': '9',
        });
        contents.emit('responsive');
        advance(1000);
        contents.emit('unresponsive');
        await flush();
        expect(report).toHaveBeenCalledTimes(1);
        contents.emit('responsive');
        advance(61_000);
        contents.emit('unresponsive');
        await flush();
        expect(report).toHaveBeenCalledTimes(2);
    });

    it('attaches the debug IDs the page registered before it hung', async () => {
        const HOT = 'app://./assets/index-BX3k.js';
        const contents = fakeContents(async () => `at spin (${HOT}:1:2345)`);
        const { client, lastBody } = createTestClient();
        installUnresponsive(
            client,
            {
                collectStack: true,
                stackTimeoutMs: 10,
                enableFeature: true,
                injectDocumentPolicyHeader: false,
                reportWithoutStack: true,
            },
            client.logger,
            {
                app: new EventEmitter() as never,
                existing: () => [contents as never],
                isVisible: () => true,
                now: () => 0,
            },
        );
        client.rendererDebugIds.set(contents as never, {
            [HOT]: ID_A,
            'app://./assets/idle.js': ID_B,
        });
        contents.emit('unresponsive');
        await flush();
        expect(postedDebugMeta(lastBody())).toEqual([{ file: HOT, debugId: ID_A }]);
    });

    it('reports a hang without debug IDs when the page registered none', async () => {
        const { contents, report } = setup();
        contents.emit('unresponsive');
        await flush();
        expect(report.mock.calls[0][0].rendererDebugIds).toBeUndefined();
    });

    it('tracks webContents created later', async () => {
        const { app, report } = setup();
        const later = fakeContents(async () => 'at x (y.js:1:1)');
        app.emit('web-contents-created', {}, later);
        later.emit('unresponsive');
        await flush();
        expect(report).toHaveBeenCalledTimes(1);
    });

    it('reports without a stack by default and warns once about the Document-Policy opt-in', async () => {
        const { contents, report, logger } = setup(
            {},
            fakeContents(async () => `${NOT_OPTED_IN_PREFIX} for JS call stacks in crash reports`),
        );
        contents.emit('unresponsive');
        await flush();
        expect(report.mock.calls[0][0].contextAttributes?.['bugsplat.stackStatus']).toBe(
            'not-opted-in',
        );
        expect(report.mock.calls[0][0].error?.stack).toContain(
            'at unresponsive.not-opted-in (electron)',
        );
        expect(logger.warn).toHaveBeenCalledWith(
            '[bugsplat]',
            expect.stringContaining('Document-Policy'),
        );
    });

    it('can drop hangs without a stack and skip collection entirely', async () => {
        const dropped = setup(
            { reportWithoutStack: false },
            fakeContents(async () => undefined),
        );
        dropped.contents.emit('unresponsive');
        await flush();
        expect(dropped.report).not.toHaveBeenCalled();

        const noCollect = setup({ collectStack: false });
        noCollect.contents.emit('unresponsive');
        await flush();
        expect(noCollect.report.mock.calls[0][0].contextAttributes?.['bugsplat.stackStatus']).toBe(
            'unavailable',
        );
    });
});
