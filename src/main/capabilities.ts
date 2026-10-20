export interface Capabilities {
    electronVersion: string;
    electronMajor: number;
    /** `WebFrameMain.collectJavaScriptCallStack()` (Electron ≥ 33.3 / 34). */
    jsCallStacks: boolean;
    /** `electron.v8-oom.*` crash keys on renderer OOM (Electron ≥ 42). */
    oomCrashKeys: boolean;
    /** OOM crash keys without the crash-key-writer crash fixed in Electron 42.10.1. */
    oomCrashKeysReliable: boolean;
    /** `session.registerPreloadScript()` (Electron ≥ 35). */
    preloadRegistration: boolean;
    /** `net.fetch()` available in this process. */
    netFetch: boolean;
}

export function parseVersion(version: string): [number, number, number] {
    const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
    if (!match) {
        return [0, 0, 0];
    }
    return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

export function compareVersions(a: string, b: string): number {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) {
            return pa[i] < pb[i] ? -1 : 1;
        }
    }
    return 0;
}

export function detectCapabilities(
    electronVersion: string | undefined,
    netFetch: boolean,
): Capabilities {
    const version = electronVersion ?? '0.0.0';
    const [major] = parseVersion(version);
    return {
        electronVersion: version,
        electronMajor: major,
        jsCallStacks: compareVersions(version, '33.3.0') >= 0,
        oomCrashKeys: major >= 42,
        oomCrashKeysReliable: compareVersions(version, '42.10.1') >= 0,
        preloadRegistration: major >= 35,
        netFetch,
    };
}
