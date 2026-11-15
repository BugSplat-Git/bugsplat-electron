type DebugIdScope = { _debugIds?: Record<string, string> };

export const ID_A = '9f2c1a7e-3b4d-4c5e-8f60-112233445566';
export const ID_B = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f00112233';
export const ID_C = '7d1e2f3a-4b5c-4d6e-9f70-a1b2c3d4e5f6';

/**
 * Register `file` in `globalThis._debugIds` the way a built script does as it loads: keyed by
 * the stack of an Error created in that script.
 */
export function registerDebugId(file: string, debugId: string): void {
    const scope = globalThis as DebugIdScope;
    scope._debugIds ??= {};
    scope._debugIds[`Error\n    at ${file}:1:1`] = debugId;
}

export function clearDebugIds(): void {
    delete (globalThis as DebugIdScope)._debugIds;
}

/** The `debugMeta` list of a posted `exceptions` form field (`undefined` when it has none). */
export function postedDebugMeta(
    body: FormData,
): Array<{ file: string; debugId: string }> | undefined {
    return (
        JSON.parse(String(body.get('exceptions'))) as {
            debugMeta?: Array<{ file: string; debugId: string }>;
        }
    ).debugMeta;
}
