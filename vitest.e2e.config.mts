import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['e2e/**/*.spec.ts'],
        exclude: ['e2e/live/**'],
        environment: 'node',
        fileParallelism: false,
        maxConcurrency: 1,
        testTimeout: 90_000,
        hookTimeout: 60_000,
        reporters: process.env.CI ? ['default', 'junit'] : ['default'],
        outputFile: { junit: 'e2e/artifacts/junit.xml' },
    },
});
