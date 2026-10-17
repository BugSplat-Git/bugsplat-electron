import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    electronMajor,
    electronVersion,
    exampleAddon,
    exampleMain,
    launchExample,
    type LaunchOptions,
    type RunningApp,
} from './launch';
import { startCaptureServer, type CaptureServer, type CapturedRequest } from './servers';

const attrs = (request: CapturedRequest): Record<string, string> =>
    JSON.parse(request.fields.attributes ?? '{}') as Record<string, string>;
const isFeedback = (request: CapturedRequest): boolean => 'title' in request.fields;
const isCrash = (request: CapturedRequest): boolean => !isFeedback(request);
/** One entry of the `exceptions` chain: the posted error first, each linked error after it. */
interface PostedException {
    parentId: number | null;
    source: string | null;
    type: string;
    message: string;
    stack?: string;
}
const exceptions = (request: CapturedRequest): PostedException[] =>
    (
        JSON.parse(request.fields.exceptions ?? '{"exceptions":[]}') as {
            exceptions: PostedException[];
        }
    ).exceptions;
/** The posted error's own stack. */
const callstack = (request: CapturedRequest): string => exceptions(request)[0]?.stack ?? '';
/** Crashpad names the process type `process_type` on recent Electron and `ptype` on older Linux builds. */
const processType = (request: CapturedRequest): string | undefined =>
    request.fields.process_type ?? request.fields.ptype;
/** Electron < 42 on Linux uploads no process-type field at all; only assert when one is present or expected. */
const expectProcessType = (crash: CapturedRequest, expected: string): void => {
    const type = processType(crash);
    if (type === undefined && electronMajor < 42) {
        return;
    }
    expect(type, fieldsOf(crash)).toBe(expected);
};
/** Assertion message listing what actually arrived (helps diagnose older Electron/Linux uploads). */
const fieldsOf = (request: CapturedRequest): string =>
    `received fields: ${Object.keys(request.fields).sort().join(', ')}`;

describe('@bugsplat/electron end-to-end (example app)', () => {
    let crashpad: CaptureServer;
    let js: CaptureServer;
    let app: RunningApp | null = null;

    beforeEach(async () => {
        expect(
            existsSync(exampleMain),
            'example must be built (npm run build && npm run build:example)',
        ).toBe(true);
        crashpad = await startCaptureServer('crashpad');
        js = await startCaptureServer('js');
    });

    afterEach(async (context) => {
        app?.save(context.task.name);
        await app?.kill();
        app = null;
        await crashpad.close();
        await js.close();
    });

    const launch = (scenario: string, extra: Partial<LaunchOptions> = {}): RunningApp => {
        app = launchExample({ scenario, submitUrl: crashpad.url, jsUrl: js.url, ...extra });
        return app;
    };

    // Electron < 42 on Linux was observed to omit identity crash keys set at startup from native
    // reports (keys added later arrive). Verified on 42+, so the floor job only checks the rest.
    const nativeIdentityKnownGap = process.platform === 'linux' && electronMajor < 42;

    const expectIdentity = (fields: Record<string, string>, native: boolean): void => {
        if (native && nativeIdentityKnownGap) {
            return;
        }
        if (native) {
            expect(fields.product).toBe('bugsplat-electron-example');
            expect(fields.version).toBe('1.0.0');
            expect(fields.key).toBe('example-key');
            expect(fields.email).toBe('fred@bugsplat.com');
            expect(fields.comments).toBe('BugSplat example app');
            expect(fields.user).toBe('Fred');
            expect(fields.channel).toBe('e2e');
            expect(fields['bugsplat.sdk']).toMatch(/^@bugsplat\/electron\//);
        } else {
            expect(fields.appName).toBe('bugsplat-electron-example');
            expect(fields.appVersion).toBe('1.0.0');
            expect(fields.appKey).toBe('example-key');
            expect(fields.email).toBe('fred@bugsplat.com');
            expect(fields.user).toBe('Fred');
            expect(fields.description).toBe('BugSplat example app');
        }
    };

    it('main-throw: uncaught exception in main is posted, then the app exits', async () => {
        const running = launch('main-throw');
        const report = await js.waitFor(isCrash);
        expectIdentity(report.fields, false);
        expect(callstack(report)).toContain('main-throw');
        expect(callstack(report)).toContain('crasher.js');
        expect(attrs(report)).toMatchObject({
            'bugsplat.origin': 'main.uncaughtException',
            'bugsplat.processType': 'browser',
            channel: 'e2e',
        });
        expect(attrs(report)['bugsplat.sdk']).toMatch(/^@bugsplat\/electron\//);
        expect(report.files['attachment.txt']?.size).toBeGreaterThan(0);
        expect(await running.exited).toBe(1);
        await crashpad.expectNone();
    });

    it('main-reject: unhandled rejection in main is posted', async () => {
        const running = launch('main-reject');
        const report = await js.waitFor(isCrash);
        expect(callstack(report)).toContain('main-reject');
        expect(attrs(report)['bugsplat.origin']).toBe('main.unhandledRejection');
        expect(await running.exited).toBe(1);
    });

    it('main-post: manual post from main carries per-call attributes', async () => {
        launch('main-post');
        const report = await js.waitFor(isCrash);
        expect(callstack(report)).toContain('manual post from main');
        expect(attrs(report)).toMatchObject({ 'bugsplat.origin': 'main.manual', manual: 'true' });
    });

    it('main-post-cause: a post with Error.cause carries the chain', async () => {
        launch('main-post-cause');
        const report = await js.waitFor(isCrash);
        expect(callstack(report)).toContain('loadUserSettings');
        expect(attrs(report)).toMatchObject({ 'bugsplat.origin': 'main.manual', manual: 'true' });
        const [root, linked] = exceptions(report);
        expect(root.message).toBe('Failed to load user settings');
        expect(linked).toMatchObject({ parentId: 0, source: 'cause', type: 'SyntaxError' });
        expect(linked.stack).toContain('loadUserSettings');
    });

    it('renderer-throw: uncaught exception in a sandboxed renderer travels over IPC', async () => {
        launch('renderer-throw');
        const report = await js.waitFor(isCrash);
        expectIdentity(report.fields, false);
        expect(callstack(report)).toContain('renderer-throw');
        expect(callstack(report)).toContain('renderer.js');
        expect(attrs(report)).toMatchObject({
            'bugsplat.origin': 'renderer.error',
            'bugsplat.processType': 'renderer',
            'bugsplat.capture': 'renderer',
            page: 'index',
        });
        expect(attrs(report)['bugsplat.url']).toMatch(/^app:\/\//);
        await crashpad.expectNone();
    });

    it('renderer-reject: unhandled rejection in the renderer', async () => {
        launch('renderer-reject');
        const report = await js.waitFor(isCrash);
        expect(callstack(report)).toContain('renderer-reject');
        expect(attrs(report)['bugsplat.origin']).toBe('renderer.unhandledrejection');
    });

    it('renderer-post + renderer-post-cause + renderer-feedback: manual posts from the page', async () => {
        launch('renderer-post');
        const report = await js.waitFor(isCrash);
        expect(attrs(report)).toMatchObject({
            'bugsplat.origin': 'renderer.manual',
            manual: 'true',
        });
        await app?.kill();

        launch('renderer-post-cause');
        const chained = await js.waitFor(isCrash);
        expect(attrs(chained)).toMatchObject({
            'bugsplat.origin': 'renderer.manual',
            manual: 'true',
        });
        const [root, linked] = exceptions(chained);
        expect(root.message).toBe('Failed to load user settings');
        expect(callstack(chained)).toContain('renderer.js');
        expect(linked).toMatchObject({ parentId: 0, source: 'cause', type: 'SyntaxError' });
        expect(linked.stack).toContain('loadUserSettings');
        await app?.kill();

        launch('renderer-feedback');
        const feedback = await js.waitFor(isFeedback);
        expect(feedback.fields.title).toBe('Feedback from the example page');
        expect(feedback.fields.description).toBe('BugSplat rocks!');
        expect(feedback.fields.user).toBe('Fred');
    });

    it('main-crash: native crash in main uploads a minidump with identity crash keys', async () => {
        launch('main-crash');
        const crash = await crashpad.waitFor();
        expectProcessType(crash, 'browser');
        expect(crash.fields.prod).toBe('Electron');
        expect(crash.fields.ver).toBe(electronVersion);
        expectIdentity(crash.fields, true);
        expect(crash.files.upload_file_minidump?.magic).toBe('MDMP');
        expect(crash.files.upload_file_minidump?.size).toBeGreaterThan(1024);
        await js.expectNone();
    });

    it('renderer-crash: renderer minidump carries identity applied through the preload', async () => {
        launch('renderer-crash');
        const crash = await crashpad.waitFor();
        expectProcessType(crash, 'renderer');
        expectIdentity(crash.fields, true);
        expect(crash.fields.page).toBe('index');
        expect(crash.files.upload_file_minidump?.magic).toBe('MDMP');
        // `crashed` already has a minidump: no companion JS report by default.
        await js.expectNone();
    });

    it('identity-from-page: identity set in the page reaches both JS and native reports', async () => {
        launch('identity-from-page');
        const report = await js.waitFor(isCrash);
        expect(report.fields.email).toBe('page@bugsplat.com');
        expect(attrs(report).plan).toBe('pro');
        const crash = await crashpad.waitFor();
        expectProcessType(crash, 'renderer');
        if (!nativeIdentityKnownGap) {
            expect(crash.fields.email).toBe('page@bugsplat.com');
        }
        expect(crash.fields.plan).toBe('pro');
    });

    it('utility-crash: crashes in utility processes are captured natively', async () => {
        launch('utility-crash');
        const crash = await crashpad.waitFor();
        expectProcessType(crash, 'utility');
        expect(crash.fields.product).toBe('bugsplat-electron-example');
        expect(crash.fields.version).toBe('1.0.0');
        expect(crash.files.upload_file_minidump?.magic).toBe('MDMP');
    });

    it.skipIf(!existsSync(exampleAddon))(
        'addon-crash: native addon crash uploads a minidump',
        async () => {
            launch('addon-crash');
            const crash = await crashpad.waitFor();
            expectProcessType(crash, 'browser');
            expect(crash.files.upload_file_minidump?.magic).toBe('MDMP');
        },
    );

    it.skipIf(electronMajor < 42)(
        'renderer-oom: OOM minidump carries the electron.v8-oom.* crash keys',
        async () => {
            launch('renderer-oom');
            const crash = await crashpad.waitFor(
                (request) => processType(request) === 'renderer',
                90_000,
            );
            const keys = Object.keys(crash.fields);
            expect(keys.some((key) => key.startsWith('electron.v8-oom.stack'))).toBe(true);
            expect(crash.fields['electron.v8-oom.heap.limit']).toBeDefined();
            expectIdentity(crash.fields, true);
        },
        120_000,
    );

    it('renderer-hang: unresponsive renderer produces a JS report with the collected call stack', async () => {
        launch('renderer-hang');
        const report = await js.waitFor(isCrash, 110_000);
        expect(attrs(report)).toMatchObject({
            'bugsplat.origin': 'unresponsive',
            'bugsplat.reason': 'unresponsive',
            'bugsplat.stackStatus': 'collected',
        });
        expect(callstack(report)).toContain('RendererUnresponsive');
        expect(callstack(report)).toContain('renderer.js');
    }, 120_000);

    it('renderer-hang (file://): pages loaded with loadFile cannot opt in to call stacks', async () => {
        launch('renderer-hang', { extraArgs: ['--load-file'] });
        const report = await js.waitFor(isCrash, 110_000);
        expect(attrs(report)['bugsplat.stackStatus']).toBe('not-opted-in');
        expect(callstack(report)).toContain('at unresponsive.not-opted-in (electron)');
    }, 120_000);

    it('net transport: main-process reports can be sent through Electron net.fetch', async () => {
        const running = launch('main-throw', { extraEnv: { BUGSPLAT_E2E_TRANSPORT: 'net' } });
        const report = await js.waitFor(isCrash);
        expect(attrs(report)['bugsplat.origin']).toBe('main.uncaughtException');
        expect(report.files['attachment.txt']?.size).toBeGreaterThan(0);
        expect(await running.exited).toBe(1);
    });
});
