import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['e2e/live/**/*.spec.ts'],
        environment: 'node',
        fileParallelism: false,
        testTimeout: 180_000,
        hookTimeout: 60_000,
        setupFiles: ['e2e/live/setup.ts'],
    },
});
