import { describe, expect, it } from 'vitest';
import {
    diffExtras,
    emptyIdentity,
    isReservedKey,
    toNativeExtras,
} from '../../src/shared/identity';

describe('identity helpers', () => {
    it('translates identity fields to the crash.php names and omits empty values', () => {
        const extras = toNativeExtras({
            ...emptyIdentity(),
            appKey: 'k',
            email: 'e@x.com',
            description: 'desc',
            notes: 'n',
            user: 'u',
            attributes: { plan: 'pro', empty: '' },
        });
        expect(extras).toEqual({
            key: 'k',
            email: 'e@x.com',
            comments: 'desc',
            notes: 'n',
            user: 'u',
            plan: 'pro',
        });
    });

    it('skips attributes whose key is too long for Crashpad or reserved', () => {
        const extras = toNativeExtras({
            ...emptyIdentity(),
            attributes: { ['k'.repeat(40)]: 'long', ['k'.repeat(39)]: 'ok', product: 'nope' },
        });
        expect(extras).toEqual({ ['k'.repeat(39)]: 'ok' });
    });

    it('diffs extras into set/remove', () => {
        expect(diffExtras({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' })).toEqual({
            set: { b: '3', c: '4' },
            remove: [],
        });
        expect(diffExtras({ a: '1' }, {})).toEqual({ set: {}, remove: ['a'] });
    });

    it('knows reserved keys', () => {
        for (const key of [
            'product',
            'version',
            'key',
            'email',
            'comments',
            'notes',
            'user',
            'guid',
        ]) {
            expect(isReservedKey(key)).toBe(true);
        }
        expect(isReservedKey('electron.v8-oom.stack')).toBe(true);
        expect(isReservedKey('bugsplat.sdk')).toBe(true);
        expect(isReservedKey('plan')).toBe(false);
    });
});
