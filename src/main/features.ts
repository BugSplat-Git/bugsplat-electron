import { app } from 'electron';
import type { Logger } from '../shared/logger';

/** Chromium feature required for `WebFrameMain.collectJavaScriptCallStack()`. */
export const JS_CALL_STACKS_FEATURE = 'DocumentPolicyIncludeJSCallStacksInCrashReports';

/** Response header a document must carry for its JS call stack to be collectable while hung. */
export const DOCUMENT_POLICY_HEADER_NAME = 'Document-Policy';
export const DOCUMENT_POLICY_HEADER_VALUE = 'include-js-call-stacks-in-crash-reports';
export const DOCUMENT_POLICY_HEADER: Readonly<Record<string, string>> = Object.freeze({
    [DOCUMENT_POLICY_HEADER_NAME]: DOCUMENT_POLICY_HEADER_VALUE,
});

/**
 * Merge the Document-Policy opt-in into a response headers map (for `protocol.handle()` handlers
 * or an app's own `webRequest.onHeadersReceived` listener). Existing `Document-Policy` values are kept.
 */
export function withJsCallStackPolicy<T extends Record<string, string | string[]>>(headers: T): T {
    const result: Record<string, string | string[]> = { ...headers };
    const existingKey = Object.keys(result).find(
        (key) => key.toLowerCase() === DOCUMENT_POLICY_HEADER_NAME.toLowerCase(),
    );
    if (!existingKey) {
        result[DOCUMENT_POLICY_HEADER_NAME] = DOCUMENT_POLICY_HEADER_VALUE;
        return result as T;
    }
    const existing = result[existingKey];
    const values = Array.isArray(existing) ? existing : [existing];
    if (!values.some((value) => value.includes(DOCUMENT_POLICY_HEADER_VALUE))) {
        result[existingKey] = Array.isArray(existing)
            ? [...existing, DOCUMENT_POLICY_HEADER_VALUE]
            : `${existing}, ${DOCUMENT_POLICY_HEADER_VALUE}`;
    }
    return result as T;
}

export interface CommandLineLike {
    getSwitchValue(name: string): string;
    appendSwitch(name: string, value?: string): void;
}

export interface AppLike {
    isReady(): boolean;
    once(event: 'ready', listener: () => void): unknown;
    commandLine: CommandLineLike;
}

/** Merge a feature into `--enable-features` (Electron's `appendSwitch` overwrites the value). */
export function enableChromiumFeature(
    feature: string,
    commandLine: CommandLineLike = app.commandLine,
): void {
    const existing = commandLine.getSwitchValue('enable-features');
    const features = new Set(existing ? existing.split(',').filter(Boolean) : []);
    if (features.has(feature)) {
        return;
    }
    features.add(feature);
    commandLine.appendSwitch('enable-features', [...features].join(','));
}

export function isChromiumFeatureEnabled(
    feature: string,
    commandLine: CommandLineLike = app.commandLine,
): boolean {
    return commandLine.getSwitchValue('enable-features').split(',').includes(feature);
}

/** Enable the JS call stack feature before ready and verify it survived at ready. */
export function enableJsCallStacks(logger: Logger, appRef: AppLike = app): boolean {
    if (appRef.isReady()) {
        logger.warn(
            `cannot enable ${JS_CALL_STACKS_FEATURE}: init() ran after the app was ready; hang reports will not include JS call stacks`,
        );
        return false;
    }
    enableChromiumFeature(JS_CALL_STACKS_FEATURE, appRef.commandLine);
    appRef.once('ready', () => {
        if (!isChromiumFeatureEnabled(JS_CALL_STACKS_FEATURE, appRef.commandLine)) {
            logger.warn(
                `--enable-features was overwritten after init(): ${JS_CALL_STACKS_FEATURE} is no longer enabled. Call init() after your own app.commandLine.appendSwitch() calls, or include the feature yourself.`,
            );
        }
    });
    return true;
}
