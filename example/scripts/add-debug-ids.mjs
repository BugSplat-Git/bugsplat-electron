// Gives each of the example's own scripts a source map debug ID, the way @bugsplat/build does in
// a Vite, Rollup or webpack build (this example is compiled with tsc alone): a `//# debugId=`
// comment, the same ID in the script's source map, and a line that records the ID in
// `globalThis._debugIds` when the script loads. @bugsplat/electron reads it from there.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const SOURCE_MAP_COMMENT = '//# sourceMappingURL=';

for (const name of readdirSync(dist).filter((entry) => entry.endsWith('.js'))) {
    const file = resolve(dist, name);
    const source = readFileSync(file, 'utf8');
    if (source.includes('//# debugId=')) {
        continue;
    }
    // The same script always gets the same ID.
    const hex = createHash('sha256').update(source).digest('hex');
    const debugId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const register = `;!function(){try{var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof window?window:"undefined"!=typeof global?global:self,n=(new e.Error).stack;n&&(e._debugIds=e._debugIds||{},e._debugIds[n]="${debugId}")}catch(e){}}();`;

    // Appended after the code, so the source map's mappings stay valid.
    const comment = source.lastIndexOf(SOURCE_MAP_COMMENT);
    const code = comment === -1 ? source : source.slice(0, comment);
    const trailer = comment === -1 ? '' : source.slice(comment);
    writeFileSync(file, `${code.trimEnd()}\n${register}\n//# debugId=${debugId}\n${trailer}`);

    const mapFile = `${file}.map`;
    if (existsSync(mapFile)) {
        const map = JSON.parse(readFileSync(mapFile, 'utf8'));
        writeFileSync(mapFile, JSON.stringify({ ...map, debugId }));
    }
}
