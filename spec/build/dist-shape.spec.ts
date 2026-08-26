import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dist = join(__dirname, '..', '..', 'dist');
const read = (name: string) => readFileSync(join(dist, name), 'utf8');

describe.skipIf(!existsSync(dist))('dist shape', () => {
    it('ships a self-contained preload that only requires electron', () => {
        const preload = read('preload.js');
        const requires = [...preload.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2]);
        expect(new Set(requires)).toEqual(new Set(['electron']));
        expect(preload).not.toMatch(/\bimport\s*\(/);
        expect(preload).toContain('bugsplat:hello');
    });

    it('ships an IIFE renderer bundle exposing BugSplatElectron', () => {
        const iife = read('renderer.global.js');
        expect(iife).toMatch(/var BugSplatElectron\s*=/);
        expect(iife).toContain('post/js/');
    });

    it('keeps main free of DOM globals and exports init', () => {
        const main = read('main.js');
        expect(main).not.toMatch(/\bwindow\./);
        expect(main).toContain('init');
        expect(existsSync(join(dist, 'main.mjs'))).toBe(true);
        expect(existsSync(join(dist, 'renderer.mjs'))).toBe(true);
        expect(existsSync(join(dist, 'preload.d.ts'))).toBe(true);
    });
});
