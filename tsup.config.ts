import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
};

const define = { __SDK_VERSION__: JSON.stringify(pkg.version) };

export default defineConfig([
    {
        entry: { main: 'src/main/index.ts' },
        format: ['cjs', 'esm'],
        platform: 'node',
        target: 'node22',
        tsconfig: 'tsconfig.json',
        dts: true,
        sourcemap: true,
        splitting: false,
        shims: true,
        clean: true,
        external: ['electron', 'bugsplat'],
        define,
    },
    {
        entry: { renderer: 'src/renderer/index.ts' },
        format: ['cjs', 'esm'],
        platform: 'browser',
        target: 'es2022',
        tsconfig: 'tsconfig.renderer.json',
        dts: true,
        sourcemap: true,
        splitting: false,
        external: ['bugsplat'],
        define,
    },
    {
        entry: { renderer: 'src/renderer/index.ts' },
        format: ['iife'],
        globalName: 'BugSplatElectron',
        platform: 'browser',
        target: 'es2022',
        tsconfig: 'tsconfig.renderer.json',
        outExtension: () => ({ js: '.global.js' }),
        noExternal: ['bugsplat'],
        sourcemap: true,
        dts: false,
        define,
    },
    {
        entry: { preload: 'src/preload/index.ts' },
        format: ['cjs'],
        platform: 'node',
        target: 'node22',
        tsconfig: 'tsconfig.preload.json',
        dts: true,
        sourcemap: true,
        external: ['electron'],
        define,
    },
]);
