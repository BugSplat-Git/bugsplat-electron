import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['spec/build/**/*.spec.ts'],
        environment: 'node',
    },
});
