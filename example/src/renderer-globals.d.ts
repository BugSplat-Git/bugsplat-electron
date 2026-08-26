// Types for the globals the page script relies on. `BugSplatElectron` comes from
// dist/vendor/renderer.global.js (the IIFE build of @bugsplat/electron/renderer).
declare const BugSplatElectron: typeof import('@bugsplat/electron/renderer');

interface DemoBridge {
    run(name: string): Promise<string>;
    crashRenderer(): void;
    hangRenderer(): void;
    onScenario(callback: (name: string) => void): void;
    versions: Record<string, string>;
}

interface Window {
    demo: DemoBridge;
}
