import { getDebugIds } from 'bugsplat';
import { debugIdsInStacks, sanitizeDebugIds } from '../shared/debug-ids';
import { LIMITS, type PostRequest } from '../shared/protocol';

/**
 * How often the page's debug ID registry is checked for scripts that loaded since the last
 * check. A check only counts the registry's keys, and one that finds none new sends nothing.
 */
export const DEBUG_ID_SYNC_INTERVAL_MS = 2000;

/** This page's source map debug IDs (file to debug ID). Never throws. */
function readDebugIds(): Record<string, string> {
    try {
        return getDebugIds();
    } catch {
        // Only a `bugsplat` older than the peer range gets here: it has no `getDebugIds`.
        return {};
    }
}

/** How many scripts have registered in `globalThis._debugIds`. Scripts only ever add to it. */
function registeredScripts(): number {
    try {
        const registry = (globalThis as { _debugIds?: unknown })._debugIds;
        return typeof registry === 'object' && registry !== null ? Object.keys(registry).length : 0;
    } catch {
        return 0;
    }
}

/**
 * `request` with the debug IDs of the scripts its error's stacks name: this page's, overridden
 * per file by `explicit` (the `debugIds` option of `post()`). The main process cannot read
 * them itself: its own `globalThis._debugIds` only knows the scripts it loaded.
 */
export function withDebugIds(request: PostRequest, explicit?: Record<string, string>): PostRequest {
    if (!request.error) {
        return request;
    }
    try {
        const debugIds = sanitizeDebugIds(
            debugIdsInStacks(request.error, { ...readDebugIds(), ...explicit }),
            LIMITS.debugIdsPerReport,
        );
        return Object.keys(debugIds).length > 0 ? { ...request, debugIds } : request;
    } catch {
        return request;
    }
}

/**
 * Hand this page's debug IDs to `push` now, once more after the calling script has finished
 * (a script registers its own ID on its last line, after the code that called `init()`), and
 * from then on whenever a check finds that more scripts have registered, such as lazily
 * loaded chunks. Every push carries the whole set, capped at `LIMITS.debugIdsPerPage`.
 * Returns a disposer.
 */
export function syncDebugIds(
    scope: Window,
    push: (debugIds: Record<string, string>) => void,
): () => void {
    let pushed = 0;
    const check = (): void => {
        try {
            const registered = registeredScripts();
            if (registered === pushed) {
                return;
            }
            pushed = registered;
            push(sanitizeDebugIds(readDebugIds(), LIMITS.debugIdsPerPage));
        } catch {
            // never throw from a timer
        }
    };
    check();
    const soon = scope.setTimeout(check, 0);
    const interval = scope.setInterval(check, DEBUG_ID_SYNC_INTERVAL_MS);
    return () => {
        scope.clearTimeout(soon);
        scope.clearInterval(interval);
    };
}
