import { utf8ByteLength } from './text';

/** Identity shared by native crash keys, main-process JS reports and every renderer. */
export interface IdentitySnapshot {
    /** Monotonically increasing; consumers ignore snapshots with `seq <= lastApplied`. */
    seq: number;
    appKey: string;
    user: string;
    email: string;
    description: string;
    notes: string;
    attributes: Record<string, string>;
}

export interface IdentityPatch {
    appKey?: string;
    user?: string;
    email?: string;
    description?: string;
    notes?: string;
    /** `null`/`undefined` values remove the attribute. */
    attributes?: Record<string, string | null | undefined>;
    /** Replace the attribute map instead of merging (bugsplat `setDefaultAttributes` semantics). */
    replaceAttributes?: boolean;
}

export const IDENTITY_FIELDS = ['appKey', 'user', 'email', 'description', 'notes'] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

/** Electron drops crash keys whose name is 40 bytes or longer. */
export const NATIVE_KEY_MAX_BYTES = 39;
/** Electron truncates crash key values longer than this. */
export const NATIVE_VALUE_MAX_BYTES = 20320;
/** Values longer than this may be split into `key__1`, `key__2`, ... on upload. */
export const NATIVE_VALUE_CHUNK_WARN_BYTES = 4096;

/**
 * Identity field → Crashpad annotation name read by
 * `https://{database}.bugsplat.com/post/electron/v2/crash.php`.
 */
export const NATIVE_IDENTITY_KEYS: Readonly<Record<IdentityField, string>> = {
    appKey: 'key',
    user: 'user',
    email: 'email',
    description: 'comments',
    notes: 'notes',
};

/** Form fields and crash keys that users must not set through `attributes`/`extra`. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
    'product',
    'version',
    'key',
    'email',
    'comments',
    'notes',
    'user',
    'ipAddress',
    'ver',
    'platform',
    'process_type',
    'guid',
    'prod',
    '_version',
    '_productName',
    '_companyName',
    'upload_file_minidump',
]);

export function isReservedKey(key: string): boolean {
    return RESERVED_KEYS.has(key) || key.startsWith('electron.') || key.startsWith('bugsplat.');
}

export function isNativeKeyAllowed(key: string): boolean {
    return key.length > 0 && utf8ByteLength(key) <= NATIVE_KEY_MAX_BYTES;
}

export function emptyIdentity(): IdentitySnapshot {
    return { seq: 0, appKey: '', user: '', email: '', description: '', notes: '', attributes: {} };
}

export function cloneIdentity(snapshot: IdentitySnapshot): IdentitySnapshot {
    return { ...snapshot, attributes: { ...snapshot.attributes } };
}

/**
 * Crash keys (per-process `crashReporter.addExtraParameter`) for an identity snapshot.
 * Empty values are omitted; attribute keys too long for Crashpad are skipped.
 */
export function toNativeExtras(snapshot: IdentitySnapshot): Record<string, string> {
    const extras: Record<string, string> = {};
    for (const field of IDENTITY_FIELDS) {
        const value = snapshot[field];
        if (value) {
            extras[NATIVE_IDENTITY_KEYS[field]] = value;
        }
    }
    for (const [key, value] of Object.entries(snapshot.attributes)) {
        if (value && isNativeKeyAllowed(key) && !isReservedKey(key)) {
            extras[key] = value;
        }
    }
    return extras;
}

/** Keys to set and keys to remove to move `prev` to `next`. */
export function diffExtras(
    prev: Record<string, string>,
    next: Record<string, string>,
): { set: Record<string, string>; remove: string[] } {
    const set: Record<string, string> = {};
    const remove: string[] = [];
    for (const [key, value] of Object.entries(next)) {
        if (prev[key] !== value) {
            set[key] = value;
        }
    }
    for (const key of Object.keys(prev)) {
        if (!(key in next)) {
            remove.push(key);
        }
    }
    return { set, remove };
}
