import {
    NATIVE_KEY_MAX_BYTES,
    NATIVE_VALUE_CHUNK_WARN_BYTES,
    NATIVE_VALUE_MAX_BYTES,
    IDENTITY_FIELDS,
    cloneIdentity,
    emptyIdentity,
    isNativeKeyAllowed,
    isReservedKey,
    type IdentityPatch,
    type IdentitySnapshot,
} from '../shared/identity';
import { OnceLogger, type Logger } from '../shared/logger';
import { truncateUtf8, utf8ByteLength } from '../shared/text';

type Listener = (snapshot: IdentitySnapshot) => void;

/**
 * Single source of truth for identity in the main process. Every change bumps `seq`
 * and notifies subscribers (native crash keys, IPC broadcast).
 */
export class IdentityStore {
    private snapshot: IdentitySnapshot = emptyIdentity();
    private readonly listeners = new Set<Listener>();
    private readonly once: OnceLogger;

    constructor(
        initial: IdentityPatch | undefined,
        private readonly logger: Logger,
    ) {
        this.once = new OnceLogger(logger);
        if (initial) {
            this.apply(initial);
        }
    }

    get(): IdentitySnapshot {
        return cloneIdentity(this.snapshot);
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Apply a patch; returns the new snapshot, or `null` when nothing changed. */
    apply(patch: IdentityPatch): IdentitySnapshot | null {
        const next = cloneIdentity(this.snapshot);
        let changed = false;

        for (const field of IDENTITY_FIELDS) {
            const value = patch[field];
            if (value === undefined) {
                continue;
            }
            const sanitized = this.sanitizeValue(field, value);
            if (next[field] !== sanitized) {
                next[field] = sanitized;
                changed = true;
            }
        }

        if (patch.attributes !== undefined || patch.replaceAttributes) {
            const attributes = patch.replaceAttributes ? {} : { ...next.attributes };
            for (const [key, value] of Object.entries(patch.attributes ?? {})) {
                if (!key) {
                    continue;
                }
                if (isReservedKey(key)) {
                    this.once.warnOnce(
                        `reserved:${key}`,
                        `attribute "${key}" is reserved and was ignored; use the dedicated option/setter instead`,
                    );
                    continue;
                }
                if (value === null || value === undefined) {
                    delete attributes[key];
                    continue;
                }
                if (!isNativeKeyAllowed(key)) {
                    this.once.warnOnce(
                        `long-key:${key}`,
                        `attribute "${key}" is longer than ${NATIVE_KEY_MAX_BYTES} bytes: it is sent with JavaScript reports only, not with native crash reports`,
                    );
                }
                attributes[key] = this.sanitizeValue(key, value);
            }
            if (JSON.stringify(attributes) !== JSON.stringify(next.attributes)) {
                next.attributes = attributes;
                changed = true;
            }
        }

        if (!changed) {
            return null;
        }
        next.seq = this.snapshot.seq + 1;
        this.snapshot = next;
        const published = cloneIdentity(next);
        for (const listener of this.listeners) {
            try {
                listener(published);
            } catch (error) {
                this.logger.error('identity listener failed', error);
            }
        }
        return published;
    }

    private sanitizeValue(key: string, value: unknown): string {
        const text = typeof value === 'string' ? value : String(value);
        const bytes = utf8ByteLength(text);
        if (bytes > NATIVE_VALUE_MAX_BYTES) {
            this.once.warnOnce(
                `truncate:${key}`,
                `value for "${key}" is ${bytes} bytes and was truncated to ${NATIVE_VALUE_MAX_BYTES} bytes`,
            );
            return truncateUtf8(text, NATIVE_VALUE_MAX_BYTES);
        }
        if (bytes > NATIVE_VALUE_CHUNK_WARN_BYTES) {
            this.once.warnOnce(
                `chunk:${key}`,
                `value for "${key}" is ${bytes} bytes; Electron may upload it as "${key}__1", "${key}__2", ...`,
            );
        }
        return text;
    }
}
