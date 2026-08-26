import { BrowserWindow, app, session, type Session, type WebContents } from 'electron';
import { OnceLogger, type Logger } from '../../shared/logger';
import { withJsCallStackPolicy } from '../features';
import type { BugSplatElectron } from '../client';
import type { UnresponsiveOptions } from '../options';
import {
    describeWebContents,
    trackWebContents,
    type WebContentsTrackerDeps,
} from './track-web-contents';

export type StackStatus = 'collected' | 'timeout' | 'unavailable' | 'not-opted-in' | 'unsupported';

/** Electron resolves this string when the document lacks the Document-Policy opt-in. */
export const NOT_OPTED_IN_PREFIX = 'Website owner has not opted in';

/** Minimum time between two hang reports for the same webContents. */
export const HANG_REPORT_INTERVAL_MS = 60_000;

export interface FrameLike {
    collectJavaScriptCallStack?: () => Promise<string | void>;
}

/**
 * Collect the JS call stack of a hung frame. `collectJavaScriptCallStack()` never resolves
 * when no JavaScript is running, so it is raced against a timeout.
 */
export async function collectStack(
    frame: FrameLike | null | undefined,
    timeoutMs: number,
): Promise<{ stack?: string; status: StackStatus }> {
    if (!frame || typeof frame.collectJavaScriptCallStack !== 'function') {
        return { status: 'unsupported' };
    }
    const TIMEOUT = Symbol('timeout');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            frame.collectJavaScriptCallStack(),
            new Promise<typeof TIMEOUT>((resolve) => {
                timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
            }),
        ]);
        if (result === TIMEOUT) {
            return { status: 'timeout' };
        }
        if (typeof result !== 'string' || !result.trim()) {
            return { status: 'unavailable' };
        }
        if (result.startsWith(NOT_OPTED_IN_PREFIX)) {
            return { status: 'not-opted-in' };
        }
        return { stack: result, status: 'collected' };
    } catch {
        return { status: 'unavailable' };
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

/** Normalize a collected stack into `    at ...` lines BugSplat can group on. */
export function formatCollectedStack(stack: string): string {
    return stack
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `    ${line.startsWith('at ') ? line : `at ${line}`}`)
        .join('\n');
}

export function buildHangError(
    message: string,
    collected: { stack?: string; status: StackStatus },
): Error {
    const error = new Error(message);
    error.name = 'RendererUnresponsive';
    error.stack =
        collected.status === 'collected' && collected.stack
            ? `${error.name}: ${message}\n${formatCollectedStack(collected.stack)}`
            : `${error.name}: ${message}\n    at unresponsive.${collected.status} (electron)`;
    return error;
}

export interface UnresponsiveDeps extends WebContentsTrackerDeps {
    isVisible: (contents: WebContents) => boolean | undefined;
    now: () => number;
}

const defaultDeps = (): UnresponsiveDeps => ({
    app,
    existing: () => [],
    isVisible: (contents) => BrowserWindow.fromWebContents(contents)?.isVisible(),
    now: () => Date.now(),
});

/** Report renderer hangs (`unresponsive`), with the JS call stack when Electron can collect it. */
export function installUnresponsive(
    client: BugSplatElectron,
    options: Required<UnresponsiveOptions>,
    logger: Logger,
    deps: UnresponsiveDeps = { ...defaultDeps(), existing: () => [] },
): () => void {
    const once = new OnceLogger(logger);

    const track = (contents: WebContents): void => {
        const state = { hanging: false, lastReportAt: Number.NEGATIVE_INFINITY };
        const onUnresponsive = async (): Promise<void> => {
            if (state.hanging) {
                return;
            }
            state.hanging = true;
            if (deps.now() - state.lastReportAt < HANG_REPORT_INTERVAL_MS) {
                return;
            }
            try {
                const collected = options.collectStack
                    ? await collectStack(contents.mainFrame as FrameLike, options.stackTimeoutMs)
                    : { status: 'unavailable' as const };
                if (collected.status === 'not-opted-in') {
                    once.warnOnce(
                        'not-opted-in',
                        'hang call stacks are unavailable: the page was not served with "Document-Policy: include-js-call-stacks-in-crash-reports" (use withJsCallStackPolicy() in your protocol.handle() responses; file:// pages cannot opt in)',
                    );
                }
                if (collected.status !== 'collected' && !options.reportWithoutStack) {
                    return;
                }
                const context = describeWebContents(contents, deps.isVisible);
                const target = context['bugsplat.title'] || context['bugsplat.url'] || 'renderer';
                state.lastReportAt = deps.now();
                await client.report({
                    kind: 'crash',
                    origin: 'unresponsive',
                    error: buildHangError(`Renderer unresponsive: ${target}`, collected),
                    contextAttributes: {
                        'bugsplat.processType': 'renderer',
                        'bugsplat.reason': 'unresponsive',
                        'bugsplat.stackStatus': collected.status,
                        ...context,
                    },
                });
            } catch (error) {
                logger.error('unresponsive handler failed', error);
            }
        };
        const onResponsive = (): void => {
            state.hanging = false;
        };
        contents.on('unresponsive', () => void onUnresponsive());
        contents.on('responsive', onResponsive);
    };

    return trackWebContents(track, deps);
}

/**
 * Opt-in: add the Document-Policy header to every document response of a session.
 * Electron only keeps the last `onHeadersReceived` listener per session, so this replaces any
 * listener the app installs on the same session.
 */
export function injectDocumentPolicyHeader(ses: Session, logger: Logger): void {
    try {
        ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
            if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
                callback({ responseHeaders: withJsCallStackPolicy(details.responseHeaders ?? {}) });
                return;
            }
            callback({});
        });
    } catch (error) {
        logger.warn('failed to inject the Document-Policy header', error);
    }
}

export function installDocumentPolicyInjection(
    logger: Logger,
    appRef: Pick<typeof app, 'on' | 'whenReady'> = app,
    defaultSession: () => Session = () => session.defaultSession,
): void {
    logger.warn(
        'unresponsive.injectDocumentPolicyHeader replaces any webRequest.onHeadersReceived listener your app registers on the same session',
    );
    const seen = new WeakSet<Session>();
    const inject = (ses: Session): void => {
        if (seen.has(ses)) {
            return;
        }
        seen.add(ses);
        injectDocumentPolicyHeader(ses, logger);
    };
    appRef.on('session-created', inject);
    void appRef.whenReady().then(() => inject(defaultSession()));
}
