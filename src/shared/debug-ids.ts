import { LIMITS, type SerializedError } from './protocol';

const NORMALISED_DEBUG_ID = /^[0-9a-f]{32}$/;

/** A source map debug ID: 32 hex characters once lowercased and stripped of hyphens. */
function isDebugId(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length <= LIMITS.debugIdLength &&
        NORMALISED_DEBUG_ID.test(value.toLowerCase().replace(/-/g, ''))
    );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
}

/**
 * The valid entries of an untrusted file to debug ID map, as a new object. Anything that is
 * not a plain object gives `{}`. An entry is dropped when its file is empty or longer than
 * `LIMITS.debugIdFileLength`, or when its value is not a debug ID. Reading stops at
 * `maxEntries` entries or `LIMITS.debugIdFilesLength` of file names. Never throws.
 *
 * Every value that is kept is a string, so a `__proto__` key cannot change the result's
 * prototype: assigning a string to `__proto__` does nothing.
 */
export function sanitizeDebugIds(value: unknown, maxEntries: number): Record<string, string> {
    const debugIds: Record<string, string> = {};
    try {
        if (!isPlainObject(value)) {
            return debugIds;
        }
        let entries = 0;
        let filesLength = 0;
        for (const file of Object.keys(value)) {
            if (entries >= maxEntries) {
                break;
            }
            const debugId = value[file];
            if (
                file.length === 0 ||
                file.length > LIMITS.debugIdFileLength ||
                !isDebugId(debugId)
            ) {
                continue;
            }
            if (filesLength + file.length > LIMITS.debugIdFilesLength) {
                break;
            }
            debugIds[file] = debugId;
            entries++;
            filesLength += file.length;
        }
    } catch {
        // Keep the entries read before the value threw.
    }
    return debugIds;
}

/**
 * The entries of `debugIds` whose file is named by a frame (`<file>:<line>`) in the stack of
 * `error` or of one of its causes.
 */
export function debugIdsInStacks(
    error: SerializedError,
    debugIds: Record<string, string>,
): Record<string, string> {
    const stacks: string[] = [];
    for (let link: SerializedError | undefined = error; link; link = link.cause) {
        stacks.push(link.stack);
    }
    const named: Record<string, string> = {};
    for (const file of Object.keys(debugIds)) {
        if (stacks.some((stack) => stack.includes(`${file}:`))) {
            named[file] = debugIds[file];
        }
    }
    return named;
}
