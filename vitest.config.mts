import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    resolve: {
        alias: {
            electron: fileURLToPath(new URL('./__mocks__/electron.ts', import.meta.url)),
        },
    },
    define: {
        __SDK_VERSION__: JSON.stringify('0.0.0-test'),
    },
    test: {
        include: ['spec/**/*.spec.ts'],
        exclude: ['spec/build/**'],
        environment: 'node',
        setupFiles: ['spec/setup.ts'],
        clearMocks: true,
        restoreMocks: true,
    },
});
