// Copies static assets and the @bugsplat/electron renderer bundle into dist/.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
mkdirSync(resolve(dist, 'vendor'), { recursive: true });

cpSync(resolve(root, 'index.html'), resolve(dist, 'index.html'));
cpSync(resolve(root, 'src/assets'), resolve(dist, 'assets'), { recursive: true });

const require = createRequire(import.meta.url);
const sdkRoot = dirname(require.resolve('@bugsplat/electron/package.json'));
const rendererBundle = resolve(sdkRoot, 'dist/renderer.global.js');
if (!existsSync(rendererBundle)) {
    console.error(`Missing ${rendererBundle} — run \`npm run build\` at the repo root first.`);
    process.exit(1);
}
cpSync(rendererBundle, resolve(dist, 'vendor/renderer.global.js'));
cpSync(`${rendererBundle}.map`, resolve(dist, 'vendor/renderer.global.js.map'));
