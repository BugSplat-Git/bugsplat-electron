import { getDebugIds } from 'bugsplat';
import type { WebContents } from 'electron';

/**
 * The source map debug IDs each page last registered (file to debug ID), kept so a hang report
 * can carry them: the main process builds that report while the page cannot answer.
 */
export class RendererDebugIds {
    private readonly byContents = new WeakMap<WebContents, Record<string, string>>();

    /** Replace what `contents` registered. The entry is removed when `contents` is destroyed. */
    set(contents: WebContents, debugIds: Record<string, string>): void {
        if (contents.isDestroyed()) {
            return;
        }
        if (!this.byContents.has(contents)) {
            contents.once('destroyed', () => this.byContents.delete(contents));
        }
        this.byContents.set(contents, debugIds);
    }

    get(contents: WebContents): Record<string, string> | undefined {
        return this.byContents.get(contents);
    }
}

/**
 * The `debugIds` option for a report whose stacks name scripts that ran in a renderer.
 *
 * Per file, lowest precedence first: `fromRenderer`, the main process's own
 * `globalThis._debugIds`, then `explicit` (the `debugIds` the caller of `post()` passed).
 * `bugsplat` reads the main process's registry itself and lets this option override it, so a
 * renderer's entry for a file the main process registered is left out here.
 */
export function mergeDebugIds(
    fromRenderer: Record<string, string> | undefined,
    explicit: Record<string, string> | undefined,
): Record<string, string> | undefined {
    if (!fromRenderer || Object.keys(fromRenderer).length === 0) {
        return explicit;
    }
    let own: Record<string, string> = {};
    try {
        own = getDebugIds();
    } catch {
        // Only a `bugsplat` older than the peer range gets here: it has no `getDebugIds`.
    }
    const merged: Record<string, string> = {};
    for (const file of Object.keys(fromRenderer)) {
        if (!Object.hasOwn(own, file)) {
            merged[file] = fromRenderer[file];
        }
    }
    return { ...merged, ...explicit };
}
