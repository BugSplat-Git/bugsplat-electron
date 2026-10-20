import { join } from 'node:path';

/**
 * Absolute path of the SDK preload (`dist/preload.js`). Resolved relative to this file so it
 * works from inside `app.asar`; `require.resolve` is deliberately avoided (bundlers rewrite it).
 */
export const preloadPath: string = join(__dirname, 'preload.js');
