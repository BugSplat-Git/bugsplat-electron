import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { resolveOptions } from '../../src/main/options';
import { installProcessGone } from '../../src/main/signals/process-gone';
import { createTestClient } from '../helpers/client';

const wc = () => ({
    id: 3,
    getURL: () => 'app://index.html',
    getTitle: () => 'Main Window',
    getType: () => 'window',
});

function setup(processGone = {}, native: false | undefined = undefined) {
    const test = createTestClient();
    const report = vi
        .spyOn(test.client, 'report')
        .mockResolvedValue({ error: null, response: null, original: '' } as never);
    const app = new EventEmitter();
    const options = resolveOptions(
        { database: 'fred', processGone, native },
        { appName: 'a', appVersion: '1' },
    );
    const dispose = installProcessGone(test.client, options.processGone, test.client.logger, {
        app: app as never,
        isVisible: () => true,
    });
    return { ...test, report, app, dispose, options };
}

describe('installProcessGone', () => {
    it('reports only minidump-less renderer reasons by default', () => {
        const { app, report, options } = setup();
        expect(options.processGone.renderer).toEqual([
            'abnormal-exit',
            'launch-failed',
            'integrity-failure',
        ]);
        for (const reason of ['clean-exit', 'killed', 'crashed', 'oom', 'memory-eviction']) {
            app.emit('render-process-gone', {}, wc(), { reason, exitCode: 1 });
        }
        expect(report).not.toHaveBeenCalled();
        app.emit('render-process-gone', {}, wc(), { reason: 'abnormal-exit', exitCode: 5 });
        expect(report).toHaveBeenCalledTimes(1);
        const input = report.mock.calls[0][0];
        expect(input.origin).toBe('render-process-gone');
        expect(input.error?.name).toBe('RenderProcessGone');
        expect(input.error?.message).toBe(
            'Renderer process gone: abnormal-exit (exit code 5) — Main Window',
        );
        expect(input.error?.stack).toContain('at render-process-gone.abnormal-exit (electron)');
        expect(input.contextAttributes).toMatchObject({
            'bugsplat.processType': 'renderer',
            'bugsplat.reason': 'abnormal-exit',
            'bugsplat.exitCode': '5',
            'bugsplat.url': 'app://index.html',
            'bugsplat.title': 'Main Window',
            'bugsplat.visible': 'true',
            'bugsplat.webContentsId': '3',
        });
    });

    it('also reports crashed/oom when native reporting is disabled', () => {
        const { app, report, options } = setup({}, false);
        expect(options.processGone.renderer).toContain('crashed');
        app.emit('render-process-gone', {}, wc(), { reason: 'oom', exitCode: -1 });
        expect(report).toHaveBeenCalledTimes(1);
    });

    it('supports "all" and explicit lists and false', () => {
        const all = setup({ renderer: 'all', child: false });
        all.app.emit('render-process-gone', {}, wc(), { reason: 'crashed', exitCode: 1 });
        all.app.emit('render-process-gone', {}, wc(), { reason: 'clean-exit', exitCode: 0 });
        all.app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 1 });
        expect(all.report).toHaveBeenCalledTimes(1);
        const explicit = setup({ renderer: ['killed'] });
        explicit.app.emit('render-process-gone', {}, wc(), { reason: 'killed', exitCode: 9 });
        explicit.app.emit('render-process-gone', {}, wc(), {
            reason: 'abnormal-exit',
            exitCode: 9,
        });
        expect(explicit.report).toHaveBeenCalledTimes(1);
    });

    it('reports child processes with type and service name', () => {
        const { app, report } = setup();
        app.emit(
            'child-process-gone',
            {},
            {
                type: 'Utility',
                reason: 'abnormal-exit',
                exitCode: 2,
                serviceName: 'my-worker',
                name: 'worker',
            },
        );
        const input = report.mock.calls[0][0];
        expect(input.origin).toBe('child-process-gone');
        expect(input.error?.message).toBe(
            'Utility process gone: abnormal-exit (exit code 2) — my-worker',
        );
        expect(input.contextAttributes).toMatchObject({
            'bugsplat.processType': 'Utility',
            'bugsplat.serviceName': 'my-worker',
            'bugsplat.name': 'worker',
        });
    });

    it('rate limits storms and never throws', () => {
        const { app, report } = setup();
        report.mockRejectedValue(new Error('post failed'));
        for (let i = 0; i < 10; i++) {
            expect(() =>
                app.emit('render-process-gone', {}, wc(), { reason: 'launch-failed', exitCode: 1 }),
            ).not.toThrow();
        }
        expect(report).toHaveBeenCalledTimes(5);
    });

    it('disposes listeners', () => {
        const { app, dispose } = setup();
        expect(app.listenerCount('render-process-gone')).toBe(1);
        dispose();
        expect(app.listenerCount('render-process-gone')).toBe(0);
        expect(app.listenerCount('child-process-gone')).toBe(0);
    });
});
