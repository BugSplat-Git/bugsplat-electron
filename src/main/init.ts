import { app, crashReporter, net } from 'electron';
import { createLogger, type Logger } from '../shared/logger';
import { detectCapabilities } from './capabilities';
import { BugSplatElectron } from './client';
import { IdentityStore } from './identity-store';
import { NativeExtrasSync, startNative } from './native';
import { resolveOptions, type BugSplatElectronOptions, type ResolvedOptions } from './options';
import { installProcessErrorHandlers } from './signals/process-errors';
import { defaultSteps } from './steps';
import { createFetch } from './transport';

export const SDK_VERSION: string = __SDK_VERSION__;

const GLOBAL_KEY = Symbol.for('@bugsplat/electron/client');

type GlobalWithClient = typeof globalThis & { [GLOBAL_KEY]?: BugSplatElectron };

/** Extra setup steps registered by other modules (preload/ipc/signals). */
export interface InitStep {
    name: string;
    run(context: InitContext): void;
}

export interface InitContext {
    client: BugSplatElectron;
    options: ResolvedOptions;
    logger: Logger;
}

const extraSteps: InitStep[] = [];

/** @internal Register an additional setup step (used by tests and extensions). */
export function registerInitStep(step: InitStep): void {
    extraSteps.push(step);
}

function safely<T>(fn: () => T, fallback: T): T {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

/**
 * Initialize BugSplat for this Electron app. Call it at module top level in the main process,
 * before `app.whenReady()`. Never throws and is idempotent.
 */
export function init(options: BugSplatElectronOptions): BugSplatElectron {
    const logger = createLogger(options?.logger);
    const existing = getClient();
    if (existing) {
        logger.warn('init() was called more than once; returning the existing client');
        return existing;
    }

    const resolved = resolveOptions(options ?? ({} as BugSplatElectronOptions), {
        appName: safely(() => app.name || app.getName(), 'electron-app'),
        appVersion: safely(() => app.getVersion(), '0.0.0'),
    });
    const capabilities = detectCapabilities(
        safely(() => process.versions.electron, undefined),
        safely(() => typeof net?.fetch === 'function', false),
    );
    const store = new IdentityStore(resolved.initialIdentity, logger);
    const client = new BugSplatElectron({
        options: resolved,
        store,
        logger,
        capabilities,
        sdkVersion: SDK_VERSION,
        fetchImpl: createFetch(resolved.transport),
    });
    (globalThis as GlobalWithClient)[GLOBAL_KEY] = client;

    if (!resolved.database) {
        logger.warn('no "database" was configured: crash and error reporting is disabled');
    }
    if (safely(() => app.isReady(), false)) {
        logger.warn(
            'init() was called after the app was ready: renderers created earlier are not monitored by the crash reporter, and hang call stacks cannot be enabled',
        );
    }
    if (capabilities.electronMajor > 0 && capabilities.electronMajor < 35) {
        logger.warn(
            `Electron ${capabilities.electronVersion} is below the supported floor (35); some features are disabled`,
        );
    }
    if (capabilities.oomCrashKeys && !capabilities.oomCrashKeysReliable) {
        logger.warn(
            `Electron ${capabilities.electronVersion} can lose the OOM crash signature while writing crash keys; upgrade to 42.10.1 or later`,
        );
    }

    const context: InitContext = { client, options: resolved, logger };
    const run = (name: string, fn: () => void): void => {
        try {
            fn();
        } catch (error) {
            logger.error(`${name} setup failed`, error);
        }
    };

    run('native crash reporter', () => {
        if (resolved.native === false || !resolved.database) {
            return;
        }
        const started = startNative(
            crashReporter,
            {
                database: resolved.database,
                application: resolved.application,
                version: resolved.version,
                sdkVersion: SDK_VERSION,
                native: resolved.native,
            },
            logger,
        );
        client.nativeStarted = started;
        if (started) {
            const sync = new NativeExtrasSync(crashReporter, logger);
            sync.apply(store.get());
            store.subscribe((snapshot) => sync.apply(snapshot));
            // Some Electron builds (observed on 35/Linux) drop crash keys that were set before the
            // app was ready; re-issuing them once is idempotent everywhere else.
            void Promise.resolve(safely(() => app.whenReady(), Promise.resolve()))
                .then(() => sync.reapply(store.get()))
                .catch(() => undefined);
        }
    });

    run('main process error handlers', () => {
        installProcessErrorHandlers(client, resolved.main, logger);
    });

    for (const step of [...defaultSteps(), ...extraSteps]) {
        run(step.name, () => step.run(context));
    }

    return client;
}

/** The client created by `init()`, or `null`. */
export function getClient(): BugSplatElectron | null {
    return (globalThis as GlobalWithClient)[GLOBAL_KEY] ?? null;
}

/** @internal */
export function resetForTests(): void {
    delete (globalThis as GlobalWithClient)[GLOBAL_KEY];
}
