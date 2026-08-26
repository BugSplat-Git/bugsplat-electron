import { describe, expect, it, vi } from 'vitest';
import { IdentityStore } from '../../src/main/identity-store';
import type { Logger } from '../../src/shared/logger';
import { utf8ByteLength } from '../../src/shared/text';

const logger = (): Logger => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('IdentityStore', () => {
    it('starts from the initial patch and bumps seq per change', () => {
        const store = new IdentityStore({ appKey: 'k', attributes: { a: '1' } }, logger());
        expect(store.get()).toMatchObject({ seq: 1, appKey: 'k', attributes: { a: '1' } });
        expect(store.apply({ email: 'e' })?.seq).toBe(2);
        expect(store.apply({ email: 'e' })).toBeNull();
        expect(store.get().seq).toBe(2);
    });

    it('notifies subscribers with copies and isolates listener errors', () => {
        const log = logger();
        const store = new IdentityStore(undefined, log);
        const seen: number[] = [];
        store.subscribe(() => {
            throw new Error('listener boom');
        });
        const unsubscribe = store.subscribe((s) => seen.push(s.seq));
        store.apply({ user: 'u' });
        store.apply({ user: 'v' });
        unsubscribe();
        store.apply({ user: 'w' });
        expect(seen).toEqual([1, 2]);
        expect(log.error).toHaveBeenCalledTimes(3);
    });

    it('merges, removes and replaces attributes', () => {
        const store = new IdentityStore({ attributes: { a: '1', b: '2' } }, logger());
        store.apply({ attributes: { b: null, c: '3' } });
        expect(store.get().attributes).toEqual({ a: '1', c: '3' });
        store.apply({ attributes: { z: '9' }, replaceAttributes: true });
        expect(store.get().attributes).toEqual({ z: '9' });
    });

    it('rejects reserved attribute keys with a single warning each', () => {
        const log = logger();
        const store = new IdentityStore(undefined, log);
        store.apply({ attributes: { product: 'x', ok: '1' } });
        store.apply({ attributes: { product: 'y' } });
        expect(store.get().attributes).toEqual({ ok: '1' });
        expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('keeps long keys for JS reports but warns once', () => {
        const log = logger();
        const store = new IdentityStore(undefined, log);
        const key = 'k'.repeat(40);
        store.apply({ attributes: { [key]: 'v' } });
        store.apply({ attributes: { [key]: 'w' } });
        expect(store.get().attributes[key]).toBe('w');
        expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('truncates values to 20320 bytes on a UTF-8 boundary and warns about chunking', () => {
        const log = logger();
        const store = new IdentityStore(undefined, log);
        store.apply({ description: '日'.repeat(10000) });
        const value = store.get().description;
        expect(utf8ByteLength(value)).toBeLessThanOrEqual(20320);
        expect(value.length).toBe(6773);
        store.apply({ notes: 'n'.repeat(5000) });
        expect(store.get().notes.length).toBe(5000);
        expect(log.warn).toHaveBeenCalledTimes(2);
    });

    it('coerces non-string values', () => {
        const store = new IdentityStore(undefined, logger());
        store.apply({
            appKey: 123 as unknown as string,
            attributes: { n: 4 as unknown as string },
        });
        expect(store.get()).toMatchObject({ appKey: '123', attributes: { n: '4' } });
    });
});
