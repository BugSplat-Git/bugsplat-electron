import type { SerializedError } from '../shared/protocol';
import { serializeError, serializeErrorEvent } from '../shared/serialize-error';

export type CaptureOrigin = 'renderer.error' | 'renderer.unhandledrejection';

export interface CaptureOptions {
    errors: boolean;
    unhandledRejections: boolean;
}

/** Hook window `error` / `unhandledrejection` in the main world. Returns a disposer. */
export function installCapture(
    scope: Window,
    options: CaptureOptions,
    onError: (error: SerializedError, origin: CaptureOrigin) => void,
): () => void {
    const href = (): string => {
        try {
            return scope.location.href;
        } catch {
            return '<renderer>';
        }
    };
    const onErrorEvent = (event: ErrorEvent): void => {
        try {
            onError(serializeErrorEvent(event, href()), 'renderer.error');
        } catch {
            // never throw from an error handler
        }
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
        try {
            onError(
                serializeError(event.reason, `unhandledrejection (${href()})`),
                'renderer.unhandledrejection',
            );
        } catch {
            // never throw from an error handler
        }
    };
    if (options.errors) {
        scope.addEventListener('error', onErrorEvent);
    }
    if (options.unhandledRejections) {
        scope.addEventListener('unhandledrejection', onRejection);
    }
    return () => {
        scope.removeEventListener('error', onErrorEvent);
        scope.removeEventListener('unhandledrejection', onRejection);
    };
}
