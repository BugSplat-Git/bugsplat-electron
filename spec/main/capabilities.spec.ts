import { describe, expect, it } from 'vitest';
import { compareVersions, detectCapabilities } from '../../src/main/capabilities';

describe('capabilities', () => {
    it.each([
        [
            '35.0.0',
            {
                jsCallStacks: true,
                oomCrashKeys: false,
                oomCrashKeysReliable: false,
                preloadRegistration: true,
            },
        ],
        [
            '41.10.7',
            {
                jsCallStacks: true,
                oomCrashKeys: false,
                oomCrashKeysReliable: false,
                preloadRegistration: true,
            },
        ],
        [
            '42.0.0',
            {
                jsCallStacks: true,
                oomCrashKeys: true,
                oomCrashKeysReliable: false,
                preloadRegistration: true,
            },
        ],
        [
            '42.10.1',
            {
                jsCallStacks: true,
                oomCrashKeys: true,
                oomCrashKeysReliable: true,
                preloadRegistration: true,
            },
        ],
        [
            '44.0.0',
            {
                jsCallStacks: true,
                oomCrashKeys: true,
                oomCrashKeysReliable: true,
                preloadRegistration: true,
            },
        ],
        [
            '33.2.0',
            {
                jsCallStacks: false,
                oomCrashKeys: false,
                oomCrashKeysReliable: false,
                preloadRegistration: false,
            },
        ],
    ])('detects capabilities for Electron %s', (version, expected) => {
        expect(detectCapabilities(version, true)).toMatchObject({
            ...expected,
            electronVersion: version,
        });
    });

    it('handles missing versions', () => {
        expect(detectCapabilities(undefined, false)).toMatchObject({
            electronMajor: 0,
            jsCallStacks: false,
            netFetch: false,
        });
    });

    it('compares versions', () => {
        expect(compareVersions('42.10.1', '42.9.9')).toBe(1);
        expect(compareVersions('42.10.1', '42.10.1')).toBe(0);
        expect(compareVersions('35.0.0-beta.1', '35.0.0')).toBe(0);
        expect(compareVersions('9.0.0', '10.0.0')).toBe(-1);
    });
});
