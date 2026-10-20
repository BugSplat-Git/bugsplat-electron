import { LIMITS, type SerializedError } from './protocol';
import { describeValue, truncateUtf8 } from './text';

interface ErrorLike {
    name?: unknown;
    message?: unknown;
    stack?: unknown;
    cause?: unknown;
}

function isErrorLike(value: unknown): value is ErrorLike {
    if (value instanceof Error) {
        return true;
    }
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as ErrorLike).message === 'string' &&
        (typeof (value as ErrorLike).stack === 'string' ||
            typeof (value as ErrorLike).name === 'string')
    );
}

/** `Error: message\n    at location` — a stack BugSplat can group on. */
export function synthesizeStack(name: string, message: string, location: string): string {
    const first = message ? `${name}: ${message}` : name;
    return `${first}\n    at ${location}`;
}

/**
 * Serialize anything that was thrown or rejected into a plain, IPC-safe object.
 * Non-Error values get a synthetic stack whose single frame is `location`.
 */
export function serializeError(
    value: unknown,
    location: string = '<unknown>',
    depth: number = 0,
): SerializedError {
    if (isErrorLike(value)) {
        const name = typeof value.name === 'string' && value.name ? value.name : 'Error';
        const message = truncateUtf8(
            typeof value.message === 'string' ? value.message : describeValue(value.message),
            LIMITS.messageBytes,
        );
        const stack =
            typeof value.stack === 'string' && value.stack
                ? truncateUtf8(value.stack, LIMITS.stackBytes)
                : synthesizeStack(name, message, location);
        const serialized: SerializedError = { name, message, stack };
        if (value.cause !== undefined && depth < LIMITS.causeDepth) {
            serialized.cause = serializeError(value.cause, location, depth + 1);
        }
        return serialized;
    }
    const message = describeValue(value, LIMITS.messageBytes);
    return { name: 'Error', message, stack: synthesizeStack('Error', message, location) };
}

/** Build a `SerializedError` from the arguments of a window `error` event. */
export function serializeErrorEvent(
    event: {
        message?: unknown;
        filename?: unknown;
        lineno?: unknown;
        colno?: unknown;
        error?: unknown;
    },
    href: string = '<unknown>',
): SerializedError {
    if (event.error !== null && event.error !== undefined) {
        return serializeError(event.error, href);
    }
    const message = describeValue(event.message ?? 'Unknown error', LIMITS.messageBytes);
    const filename = typeof event.filename === 'string' && event.filename ? event.filename : href;
    const line = typeof event.lineno === 'number' ? event.lineno : 0;
    const col = typeof event.colno === 'number' ? event.colno : 0;
    return {
        name: 'Error',
        message,
        stack: synthesizeStack('Error', message, `<anonymous> (${filename}:${line}:${col})`),
    };
}

/** Rebuild an `Error` (preserving name/stack/cause) from its serialized form. */
export function deserializeError(serialized: SerializedError): Error {
    const error = new Error(serialized.message);
    error.name = serialized.name;
    error.stack = serialized.stack;
    if (serialized.cause) {
        (error as Error & { cause?: unknown }).cause = deserializeError(serialized.cause);
    }
    return error;
}

/** Coerce anything into an `Error` with a usable stack (used by main-process handlers). */
export function toError(value: unknown, location: string = '<unknown>'): Error {
    if (value instanceof Error) {
        if (!value.stack) {
            value.stack = synthesizeStack(value.name || 'Error', value.message, location);
        }
        return value;
    }
    return deserializeError(serializeError(value, location));
}
