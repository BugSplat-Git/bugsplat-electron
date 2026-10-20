import { describe, expect, it, vi } from 'vitest';
import {
    NativeExtrasSync,
    buildCrashReporterOptions,
    buildSubmitUrl,
    sanitizeUserExtras,
    startNative,
} from '../../src/main/native';
import { resolveOptions, type ResolvedNativeOptions } from '../../src/main/options';
import { emptyIdentity } from '../../src/shared/identity';
import type { Logger } from '../../src/shared/logger';

const logger = (): Logger => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

function nativeOptions(overrides: Partial<ResolvedNativeOptions> = {}): ResolvedNativeOptions {
    const resolved = resolveOptions({ database: 'fred' }, { appName: 'app', appVersion: '1.0.0' });
    return { ...(resolved.native as ResolvedNativeOptions), ...overrides };
}

describe('buildSubmitUrl', () => {
    it('builds the v2 electron endpoint', () => {
        expect(buildSubmitUrl('fred')).toBe('https://fred.bugsplat.com/post/electron/v2/crash.php');
        expect(buildSubmitUrl('  Fred_1-2 ')).toBe(
            'https://Fred_1-2.bugsplat.com/post/electron/v2/crash.php',
        );
    });

    it('rejects invalid databases', () => {
        expect(() => buildSubmitUrl('')).toThrow(/Invalid BugSplat database/);
        expect(() => buildSubmitUrl('a.b')).toThrow(/Invalid BugSplat database/);
        expect(() => buildSubmitUrl('a/b')).toThrow();
    });
});

describe('buildCrashReporterOptions', () => {
    const context = {
        database: 'fred',
        application: 'MyApp',
        version: '2.0.0',
        sdkVersion: '1.2.3',
    };

    it('maps defaults and puts only immutable facts into globalExtra', () => {
        const options = buildCrashReporterOptions(
            { ...context, native: nativeOptions() },
            logger(),
        );
        expect(options).toEqual({
            submitURL: 'https://fred.bugsplat.com/post/electron/v2/crash.php',
            productName: 'app',
            uploadToServer: true,
            ignoreSystemCrashHandler: true,
            rateLimit: false,
            compress: true,
            extra: {},
            globalExtra: {
                product: 'MyApp',
                version: '2.0.0',
                'bugsplat.sdk': '@bugsplat/electron/1.2.3',
            },
        });
    });

    it('honours overrides', () => {
        const options = buildCrashReporterOptions(
            {
                ...context,
                native: nativeOptions({
                    submitURL: 'http://127.0.0.1:1234/',
                    uploadToServer: false,
                    ignoreSystemCrashHandler: false,
                    rateLimit: true,
                    compress: false,
                    productName: 'Prod',
                    extra: { channel: 'beta' },
                    globalExtra: { build: '42' },
                }),
            },
            logger(),
        );
        expect(options.submitURL).toBe('http://127.0.0.1:1234/');
        expect(options.uploadToServer).toBe(false);
        expect(options.ignoreSystemCrashHandler).toBe(false);
        expect(options.rateLimit).toBe(true);
        expect(options.compress).toBe(false);
        expect(options.productName).toBe('Prod');
        expect(options.extra).toEqual({ channel: 'beta' });
        expect(options.globalExtra).toMatchObject({
            build: '42',
            product: 'MyApp',
            version: '2.0.0',
        });
    });

    it('rejects reserved keys in user extras with a warning', () => {
        const log = logger();
        const options = buildCrashReporterOptions(
            {
                ...context,
                native: nativeOptions({
                    globalExtra: { product: 'x', email: 'y', 'bugsplat.sdk': 'z', ok: 'yes' },
                    extra: { key: 'k', comments: 'c', fine: '1' },
                }),
            },
            log,
        );
        expect(options.globalExtra).toEqual({
            ok: 'yes',
            product: 'MyApp',
            version: '2.0.0',
            'bugsplat.sdk': '@bugsplat/electron/1.2.3',
        });
        expect(options.extra).toEqual({ fine: '1' });
        expect(log.warn).toHaveBeenCalledTimes(5);
    });
});

describe('sanitizeUserExtras', () => {
    it('drops long keys, coerces and truncates values', () => {
        const log = logger();
        const result = sanitizeUserExtras(
            { ['k'.repeat(40)]: 'x', num: 5 as unknown as string, long: 'v'.repeat(30000) },
            'extra',
            log,
        );
        expect(Object.keys(result)).toEqual(['num', 'long']);
        expect(result.num).toBe('5');
        expect(result.long.length).toBe(20320);
        expect(log.warn).toHaveBeenCalledTimes(1);
    });
});

describe('startNative', () => {
    it('never throws and reports failure', () => {
        const log = logger();
        const reporter = {
            start: vi.fn(() => {
                throw new Error('nope');
            }),
        };
        expect(
            startNative(
                reporter,
                {
                    database: 'fred',
                    application: 'a',
                    version: '1',
                    sdkVersion: '0',
                    native: nativeOptions(),
                },
                log,
            ),
        ).toBe(false);
        expect(log.error).toHaveBeenCalled();
    });

    it('returns true when start succeeds', () => {
        const reporter = { start: vi.fn() };
        expect(
            startNative(
                reporter,
                {
                    database: 'fred',
                    application: 'a',
                    version: '1',
                    sdkVersion: '0',
                    native: nativeOptions(),
                },
                logger(),
            ),
        ).toBe(true);
        expect(reporter.start).toHaveBeenCalledTimes(1);
    });
});

describe('NativeExtrasSync', () => {
    it('applies diffs with add/remove and skips no-ops', () => {
        const reporter = { addExtraParameter: vi.fn(), removeExtraParameter: vi.fn() };
        const sync = new NativeExtrasSync(reporter, logger());
        sync.apply({ ...emptyIdentity(), email: 'a@b.c', attributes: { plan: 'pro' } });
        expect(reporter.addExtraParameter).toHaveBeenCalledWith('email', 'a@b.c');
        expect(reporter.addExtraParameter).toHaveBeenCalledWith('plan', 'pro');
        reporter.addExtraParameter.mockClear();

        sync.apply({ ...emptyIdentity(), email: 'a@b.c', attributes: { plan: 'pro' } });
        expect(reporter.addExtraParameter).not.toHaveBeenCalled();

        sync.apply({ ...emptyIdentity(), email: 'x@y.z', attributes: {} });
        expect(reporter.addExtraParameter).toHaveBeenCalledWith('email', 'x@y.z');
        expect(reporter.removeExtraParameter).toHaveBeenCalledWith('plan');
    });

    it('survives reporter errors', () => {
        const reporter = {
            addExtraParameter: vi.fn(() => {
                throw new Error('bad');
            }),
            removeExtraParameter: vi.fn(),
        };
        const log = logger();
        expect(() =>
            new NativeExtrasSync(reporter, log).apply({ ...emptyIdentity(), user: 'u' }),
        ).not.toThrow();
        expect(log.warn).toHaveBeenCalled();
    });
});
