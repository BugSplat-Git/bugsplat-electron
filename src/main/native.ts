import type { CrashReporterStartOptions } from 'electron';
import {
    NATIVE_VALUE_MAX_BYTES,
    RESERVED_KEYS,
    diffExtras,
    isNativeKeyAllowed,
    toNativeExtras,
    type IdentitySnapshot,
} from '../shared/identity';
import type { Logger } from '../shared/logger';
import { truncateUtf8 } from '../shared/text';
import type { ResolvedNativeOptions } from './options';

export const ELECTRON_ENDPOINT_PATH = '/post/electron/v2/crash.php';

/** Crash keys the SDK owns; user-supplied `extra`/`globalExtra` may not set them. */
const SDK_OWNED_KEYS = new Set([...RESERVED_KEYS, 'bugsplat.sdk']);

export function buildSubmitUrl(database: string): string {
    const db = database.trim();
    if (!db || !/^[A-Za-z0-9_-]+$/.test(db)) {
        throw new Error(
            `Invalid BugSplat database "${database}": expected letters, numbers, "-" or "_"`,
        );
    }
    return `https://${db}.bugsplat.com${ELECTRON_ENDPOINT_PATH}`;
}

/** Drop reserved keys and enforce Electron's crash key limits on user-supplied extras. */
export function sanitizeUserExtras(
    extras: Record<string, string> | undefined,
    kind: 'extra' | 'globalExtra',
    logger: Logger,
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, raw] of Object.entries(extras ?? {})) {
        if (SDK_OWNED_KEYS.has(key) || key.startsWith('bugsplat.')) {
            logger.warn(
                `native.${kind}.${key} was ignored: "${key}" is set by the SDK (use the matching init option instead)`,
            );
            continue;
        }
        if (!isNativeKeyAllowed(key)) {
            logger.warn(
                `native.${kind}.${key} was ignored: crash key names must be at most 39 bytes`,
            );
            continue;
        }
        const value = typeof raw === 'string' ? raw : String(raw);
        result[key] = truncateUtf8(value, NATIVE_VALUE_MAX_BYTES);
    }
    return result;
}

export interface NativeStartContext {
    database: string;
    application: string;
    version: string;
    sdkVersion: string;
    native: ResolvedNativeOptions;
}

export function buildCrashReporterOptions(
    context: NativeStartContext,
    logger: Logger,
): CrashReporterStartOptions {
    const { native } = context;
    return {
        submitURL: native.submitURL || buildSubmitUrl(context.database),
        productName: native.productName,
        uploadToServer: native.uploadToServer,
        ignoreSystemCrashHandler: native.ignoreSystemCrashHandler,
        rateLimit: native.rateLimit,
        compress: native.compress,
        extra: sanitizeUserExtras(native.extra, 'extra', logger),
        globalExtra: {
            ...sanitizeUserExtras(native.globalExtra, 'globalExtra', logger),
            product: context.application,
            version: context.version,
            'bugsplat.sdk': `@bugsplat/electron/${context.sdkVersion}`,
        },
    };
}

export interface CrashReporterLike {
    start(options: CrashReporterStartOptions): void;
    addExtraParameter(key: string, value: string): void;
    removeExtraParameter(key: string): void;
}

/** Start Electron's crash reporter. Never throws; returns whether it started. */
export function startNative(
    reporter: Pick<CrashReporterLike, 'start'>,
    context: NativeStartContext,
    logger: Logger,
): boolean {
    try {
        reporter.start(buildCrashReporterOptions(context, logger));
        return true;
    } catch (error) {
        logger.error('crashReporter.start() failed; native crash reporting is disabled', error);
        return false;
    }
}

/**
 * Keeps this process's crash keys (`crashReporter.addExtraParameter`) equal to the identity
 * snapshot by applying diffs, so keys that disappear are removed too.
 */
export class NativeExtrasSync {
    private applied: Record<string, string> = {};

    constructor(
        private readonly reporter: Pick<
            CrashReporterLike,
            'addExtraParameter' | 'removeExtraParameter'
        >,
        private readonly logger: Logger,
    ) {}

    apply(snapshot: IdentitySnapshot): void {
        const next = toNativeExtras(snapshot);
        const { set, remove } = diffExtras(this.applied, next);
        for (const key of remove) {
            try {
                this.reporter.removeExtraParameter(key);
            } catch (error) {
                this.logger.warn(`crashReporter.removeExtraParameter("${key}") failed`, error);
            }
        }
        for (const [key, value] of Object.entries(set)) {
            try {
                this.reporter.addExtraParameter(key, value);
            } catch (error) {
                this.logger.warn(`crashReporter.addExtraParameter("${key}") failed`, error);
            }
        }
        this.applied = next;
    }
}
