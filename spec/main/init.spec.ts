import { app, crashReporter } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient, init, registerInitStep, resetForTests } from '../../src/main/init';
import type { Logger } from '../../src/shared/logger';

const quiet = { captureUncaughtExceptions: false, captureUnhandledRejections: false };
const logger = (): Logger => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('init', () => {
    beforeEach(() => resetForTests());
    afterEach(() => resetForTests());

    it('starts the crash reporter with the BugSplat endpoint and syncs identity to crash keys', () => {
        const client = init({
            database: 'fred',
            application: 'App',
            version: '3.0.0',
            email: 'fred@bugsplat.com',
            attributes: { plan: 'pro' },
            main: quiet,
            logger: null,
        });
        expect(client.nativeStarted).toBe(true);
        expect(crashReporter.start).toHaveBeenCalledTimes(1);
        const options = (crashReporter.start as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(options.submitURL).toBe('https://fred.bugsplat.com/post/electron/v2/crash.php');
        expect(options.globalExtra).toMatchObject({ product: 'App', version: '3.0.0' });
        expect(options.globalExtra.email).toBeUndefined();
        expect(crashReporter.addExtraParameter).toHaveBeenCalledWith('email', 'fred@bugsplat.com');
        expect(crashReporter.addExtraParameter).toHaveBeenCalledWith('plan', 'pro');

        client.setUser('Fred');
        expect(crashReporter.addExtraParameter).toHaveBeenCalledWith('user', 'Fred');
        client.removeAttribute('plan');
        expect(crashReporter.removeExtraParameter).toHaveBeenCalledWith('plan');
        expect(getClient()).toBe(client);
    });

    it('defaults application/version from app', () => {
        const client = init({ database: 'fred', main: quiet, logger: null });
        expect(client.application).toBe('FakeApp');
        expect(client.version).toBe('1.2.3');
    });

    it('is idempotent', () => {
        const log = logger();
        const first = init({ database: 'fred', main: quiet, logger: log });
        const second = init({ database: 'other', main: quiet, logger: log });
        expect(second).toBe(first);
        expect(crashReporter.start).toHaveBeenCalledTimes(1);
        expect(log.warn).toHaveBeenCalledWith(
            '[bugsplat]',
            expect.stringContaining('more than once'),
        );
    });

    it('does not start native reporting without a database or when disabled', () => {
        const log = logger();
        const disabled = init({ database: '', main: quiet, logger: log });
        expect(disabled.enabled).toBe(false);
        expect(crashReporter.start).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledWith(
            '[bugsplat]',
            expect.stringContaining('no "database"'),
        );
        resetForTests();
        init({ database: 'fred', native: false, main: quiet, logger: null });
        expect(crashReporter.start).not.toHaveBeenCalled();
    });

    it('warns when called after ready', () => {
        (app.isReady as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const log = logger();
        init({ database: 'fred', main: quiet, logger: log });
        expect(log.warn).toHaveBeenCalledWith(
            '[bugsplat]',
            expect.stringContaining('after the app was ready'),
        );
    });

    it('isolates failures: a throwing step or crashReporter does not prevent the client', () => {
        (crashReporter.start as ReturnType<typeof vi.fn>).mockImplementation(() => {
            throw new Error('native unavailable');
        });
        registerInitStep({
            name: 'exploding step',
            run: () => {
                throw new Error('step failed');
            },
        });
        const log = logger();
        const client = init({ database: 'fred', main: quiet, logger: log });
        expect(client.enabled).toBe(true);
        expect(client.nativeStarted).toBe(false);
        expect(log.error).toHaveBeenCalledWith(
            '[bugsplat]',
            expect.stringContaining('crashReporter.start() failed'),
            expect.any(Error),
        );
        expect(log.error).toHaveBeenCalledWith(
            '[bugsplat]',
            'exploding step setup failed',
            expect.any(Error),
        );
    });
});
