import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installProcessErrorHandlers } from '../../src/main/signals/process-errors';
import { createTestClient } from '../helpers/client';

const options = (overrides = {}) => ({
    captureUncaughtExceptions: true,
    captureUnhandledRejections: true,
    exitOnUncaughtException: false,
    exitOnUnhandledRejection: false,
    exitTimeoutMs: 50,
    ...overrides,
});

function setup(overrides = {}, fetchImpl?: () => Promise<Response>) {
    const { client, lastBody, fetchSpy } = createTestClient({}, fetchImpl);
    const proc = new EventEmitter();
    const app = { exit: vi.fn() };
    const dispose = installProcessErrorHandlers(
        client,
        options(overrides),
        client.logger,
        proc,
        app,
    );
    return { client, proc, app, dispose, lastBody, fetchSpy };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('installProcessErrorHandlers', () => {
    it('posts uncaught exceptions with the right origin and keeps running by default', async () => {
        const { proc, app, lastBody } = setup();
        proc.emit('uncaughtException', new Error('crash'));
        await flush();
        expect(JSON.parse(String(lastBody().get('attributes')))['bugsplat.origin']).toBe(
            'main.uncaughtException',
        );
        expect(app.exit).not.toHaveBeenCalled();
    });

    it('posts unhandled rejections, coercing non-Error reasons', async () => {
        const { proc, lastBody } = setup();
        proc.emit('unhandledRejection', 'just a string');
        await flush();
        expect(String(lastBody().get('callstack'))).toContain('Error: just a string');
        expect(JSON.parse(String(lastBody().get('attributes')))['bugsplat.origin']).toBe(
            'main.unhandledRejection',
        );
    });

    it('exits after posting when configured, even if the post fails', async () => {
        const failing = setup({ exitOnUncaughtException: true }, async () => {
            throw new Error('offline');
        });
        failing.proc.emit('uncaughtException', new Error('crash'));
        await flush();
        expect(failing.app.exit).toHaveBeenCalledWith(1);

        const ok = setup({ exitOnUnhandledRejection: true });
        ok.proc.emit('unhandledRejection', new Error('rej'));
        await flush();
        expect(ok.app.exit).toHaveBeenCalledWith(1);
        expect(ok.fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('respects capture toggles and disposes', () => {
        const { proc, dispose } = setup({
            captureUncaughtExceptions: false,
            captureUnhandledRejections: false,
        });
        expect(proc.listenerCount('uncaughtException')).toBe(0);
        expect(proc.listenerCount('unhandledRejection')).toBe(0);
        const on = setup();
        expect(on.proc.listenerCount('uncaughtException')).toBe(1);
        on.dispose();
        dispose();
        expect(on.proc.listenerCount('uncaughtException')).toBe(0);
    });

    it('rate limits exception storms', async () => {
        const { proc, fetchSpy } = setup();
        for (let i = 0; i < 5; i++) {
            proc.emit('uncaughtException', new Error(`storm ${i}`));
        }
        await flush();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});
