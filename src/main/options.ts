import type { BugSplatOptions } from 'bugsplat';
import type { IpcMainEvent, IpcMainInvokeEvent, Session } from 'electron';
import type { IdentityPatch } from '../shared/identity';
import type { Logger } from '../shared/logger';
import type { ReportOrigin } from '../shared/protocol';

export type GoneReason =
    | 'clean-exit'
    | 'abnormal-exit'
    | 'killed'
    | 'crashed'
    | 'oom'
    | 'launch-failed'
    | 'integrity-failure'
    | 'memory-eviction';

/** Reasons that never come with a Crashpad minidump, so a JS marker report is the only record. */
export const MINIDUMP_LESS_REASONS: readonly GoneReason[] = [
    'abnormal-exit',
    'launch-failed',
    'integrity-failure',
];
/** Reasons that already produce a minidump (reporting them again would double count). */
export const MINIDUMP_REASONS: readonly GoneReason[] = ['crashed', 'oom'];
export const ALL_GONE_REASONS: readonly GoneReason[] = [
    'abnormal-exit',
    'killed',
    'crashed',
    'oom',
    'launch-failed',
    'integrity-failure',
    'memory-eviction',
];

export interface NativeOptions {
    /** Defaults to `https://{database}.bugsplat.com/post/electron/v2/crash.php`. */
    submitURL?: string;
    /** Electron's `productName` (sent as `_productName`). Defaults to `application`. */
    productName?: string;
    /** Default `true`. */
    uploadToServer?: boolean;
    /** Default `true` (matches the BugSplat docs; suppresses the OS crash dialog for main-process crashes). */
    ignoreSystemCrashHandler?: boolean;
    /** Default `false`. */
    rateLimit?: boolean;
    /** Default `true`. */
    compress?: boolean;
    /** Extra main-process-only crash keys. Reserved/identity names are rejected with a warning. */
    extra?: Record<string, string>;
    /**
     * Immutable crash keys sent with crashes from every process (including GPU/utility).
     * `product`, `version` and identity names are rejected: they would shadow the mutable identity forever.
     */
    globalExtra?: Record<string, string>;
}

export interface PreloadOptions {
    /** Register the SDK preload into every session automatically. Default `true`. */
    register?: boolean;
    /** Override the resolved path of `dist/preload.js` (pnpm/asar edge cases). */
    path?: string;
    /** `'all'` (default) = `session.defaultSession` plus every session created later. */
    sessions?: 'all' | Session[];
    /** Report window `error` events from the preload until the renderer SDK claims capture. Default `true`. */
    fallbackCapture?: boolean;
}

export interface MainProcessOptions {
    /** Default `true`. */
    captureUncaughtExceptions?: boolean;
    /** Default `true`. */
    captureUnhandledRejections?: boolean;
    /** Post, then `app.exit(1)`. Default `false` (keep running, like Electron's built-in handler). */
    exitOnUncaughtException?: boolean;
    /** Default `false`. */
    exitOnUnhandledRejection?: boolean;
    /** Max time to wait for the post before exiting. Default 5000. */
    exitTimeoutMs?: number;
}

export interface RendererCaptureOptions {
    /** Default `true` (window `error`). */
    captureErrors?: boolean;
    /** Default `true` (window `unhandledrejection`; main-world `init()` only). */
    captureUnhandledRejections?: boolean;
    /** Attach the page URL as `bugsplat.url`. Default `true`. */
    includeUrl?: boolean;
}

export interface ProcessGoneOptions {
    /**
     * Reasons that produce a companion JS report for `render-process-gone`.
     * Default: reasons without a minidump (`abnormal-exit`, `launch-failed`, `integrity-failure`),
     * plus `crashed`/`oom` when native reporting is disabled.
     */
    renderer?: false | 'all' | GoneReason[];
    /** Same for `child-process-gone`. */
    child?: false | 'all' | GoneReason[];
}

export interface UnresponsiveOptions {
    /** Call `WebFrameMain.collectJavaScriptCallStack()`. Default `true`. */
    collectStack?: boolean;
    /** Default 3000. The call never resolves when no JS is running. */
    stackTimeoutMs?: number;
    /** Merge `DocumentPolicyIncludeJSCallStacksInCrashReports` into `--enable-features` (before ready). Default `true`. */
    enableFeature?: boolean;
    /**
     * Add `Document-Policy: include-js-call-stacks-in-crash-reports` to every document response via
     * `session.webRequest.onHeadersReceived`. Default `false`: only the last listener registered on a
     * session is used, so this replaces any listener the app installs. Prefer `withJsCallStackPolicy()`.
     */
    injectDocumentPolicyHeader?: boolean;
    /** Post a report even when no JS stack could be collected. Default `true`. */
    reportWithoutStack?: boolean;
}

export type FetchLike = typeof globalThis.fetch;
/**
 * `'node'` (default): Node's global fetch. `'net'`: Electron's `net.fetch` once the app is ready
 * (honours system proxy/PAC and enterprise certificates), Node fetch before. Or a custom fetch.
 */
export type TransportOption = 'node' | 'net' | FetchLike;

export interface PendingReport {
    kind: 'crash' | 'feedback';
    origin: ReportOrigin;
    /** Present for `kind: 'crash'`. */
    error?: Error;
    /** Present for `kind: 'feedback'`. */
    title?: string;
    /** Fully merged post options (identity + context + per-call). */
    options: BugSplatOptions;
}

export type BeforePostHook = (
    report: PendingReport,
) => PendingReport | null | undefined | void | Promise<PendingReport | null | undefined | void>;

export type TrustSender = (event: IpcMainInvokeEvent | IpcMainEvent) => boolean;

export interface BugSplatElectronOptions {
    /** BugSplat database. Required; without it reporting is disabled (with a warning). */
    database: string;
    /** Defaults to `app.name`. Sent as `product` (native) and `appName` (JS). */
    application?: string;
    /** Defaults to `app.getVersion()`. Sent as `version` (native) and `appVersion` (JS). */
    version?: string;
    appKey?: string;
    user?: string;
    email?: string;
    description?: string;
    notes?: string;
    attributes?: Record<string, string>;
    /** Files read at post time and attached to JS reports (10 MB total). */
    additionalFilePaths?: string[];
    /** Native Crashpad reporting. `false` disables `crashReporter.start()`. */
    native?: false | NativeOptions;
    /** Preload delivery. `false` = no auto-registration. */
    preload?: false | PreloadOptions;
    main?: MainProcessOptions;
    /** Defaults pushed to every renderer through the preload bridge. */
    renderer?: RendererCaptureOptions;
    processGone?: ProcessGoneOptions;
    /** Renderer hang reports. `false` disables. */
    unresponsive?: false | UnresponsiveOptions;
    transport?: TransportOption;
    /** Single interception point for every report. Return `null` to drop it. */
    beforePost?: BeforePostHook;
    /** Which renderer frames may post reports / change identity. Default: top-level frames. */
    trustSender?: TrustSender;
    /** SDK diagnostics. `null` silences them. */
    logger?: Logger | null;
}

export interface ResolvedNativeOptions {
    submitURL?: string;
    productName: string;
    uploadToServer: boolean;
    ignoreSystemCrashHandler: boolean;
    rateLimit: boolean;
    compress: boolean;
    extra: Record<string, string>;
    globalExtra: Record<string, string>;
}

export interface ResolvedPreloadOptions {
    register: boolean;
    path?: string;
    sessions: 'all' | Session[];
    fallbackCapture: boolean;
}

export interface ResolvedOptions {
    database: string;
    application: string;
    version: string;
    initialIdentity: IdentityPatch;
    additionalFilePaths: string[];
    native: false | ResolvedNativeOptions;
    preload: false | ResolvedPreloadOptions;
    main: Required<MainProcessOptions>;
    renderer: Required<RendererCaptureOptions>;
    processGone: { renderer: false | GoneReason[]; child: false | GoneReason[] };
    unresponsive: false | Required<UnresponsiveOptions>;
    transport: TransportOption;
    beforePost?: BeforePostHook;
    trustSender?: TrustSender;
    logger?: Logger | null;
}

function resolveGoneReasons(
    value: false | 'all' | GoneReason[] | undefined,
    nativeEnabled: boolean,
): false | GoneReason[] {
    if (value === false) {
        return false;
    }
    if (value === 'all') {
        return [...ALL_GONE_REASONS];
    }
    if (Array.isArray(value)) {
        return [...value];
    }
    return nativeEnabled
        ? [...MINIDUMP_LESS_REASONS]
        : [...MINIDUMP_LESS_REASONS, ...MINIDUMP_REASONS];
}

export function resolveOptions(
    options: BugSplatElectronOptions,
    defaults: { appName: string; appVersion: string },
): ResolvedOptions {
    const application = options.application || defaults.appName;
    const version = options.version || defaults.appVersion;
    const native: false | ResolvedNativeOptions =
        options.native === false
            ? false
            : {
                  submitURL: options.native?.submitURL,
                  productName: options.native?.productName ?? application,
                  uploadToServer: options.native?.uploadToServer ?? true,
                  ignoreSystemCrashHandler: options.native?.ignoreSystemCrashHandler ?? true,
                  rateLimit: options.native?.rateLimit ?? false,
                  compress: options.native?.compress ?? true,
                  extra: { ...(options.native?.extra ?? {}) },
                  globalExtra: { ...(options.native?.globalExtra ?? {}) },
              };
    const preload: false | ResolvedPreloadOptions =
        options.preload === false
            ? false
            : {
                  register: options.preload?.register ?? true,
                  path: options.preload?.path,
                  sessions: options.preload?.sessions ?? 'all',
                  fallbackCapture: options.preload?.fallbackCapture ?? true,
              };
    const unresponsive: false | Required<UnresponsiveOptions> =
        options.unresponsive === false
            ? false
            : {
                  collectStack: options.unresponsive?.collectStack ?? true,
                  stackTimeoutMs: options.unresponsive?.stackTimeoutMs ?? 3000,
                  enableFeature: options.unresponsive?.enableFeature ?? true,
                  injectDocumentPolicyHeader:
                      options.unresponsive?.injectDocumentPolicyHeader ?? false,
                  reportWithoutStack: options.unresponsive?.reportWithoutStack ?? true,
              };
    return {
        database: (options.database ?? '').trim(),
        application,
        version,
        initialIdentity: {
            appKey: options.appKey,
            user: options.user,
            email: options.email,
            description: options.description,
            notes: options.notes,
            attributes: options.attributes,
        },
        additionalFilePaths: [...(options.additionalFilePaths ?? [])],
        native,
        preload,
        main: {
            captureUncaughtExceptions: options.main?.captureUncaughtExceptions ?? true,
            captureUnhandledRejections: options.main?.captureUnhandledRejections ?? true,
            exitOnUncaughtException: options.main?.exitOnUncaughtException ?? false,
            exitOnUnhandledRejection: options.main?.exitOnUnhandledRejection ?? false,
            exitTimeoutMs: options.main?.exitTimeoutMs ?? 5000,
        },
        renderer: {
            captureErrors: options.renderer?.captureErrors ?? true,
            captureUnhandledRejections: options.renderer?.captureUnhandledRejections ?? true,
            includeUrl: options.renderer?.includeUrl ?? true,
        },
        processGone: {
            renderer: resolveGoneReasons(options.processGone?.renderer, native !== false),
            child: resolveGoneReasons(options.processGone?.child, native !== false),
        },
        unresponsive,
        transport: options.transport ?? 'node',
        beforePost: options.beforePost,
        trustSender: options.trustSender,
        logger: options.logger,
    };
}
