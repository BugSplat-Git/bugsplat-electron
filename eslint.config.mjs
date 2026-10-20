import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    {
        ignores: [
            'dist/',
            'coverage/',
            'node_modules/',
            'release/',
            'example/dist/',
            'example/build/',
            'e2e/artifacts/',
            'eslint.config.mjs',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    prettier,
    {
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
    {
        files: ['example/scripts/**/*.mjs'],
        languageOptions: {
            globals: { console: 'readonly', process: 'readonly' },
        },
    },
    {
        // Renderer code runs in the page: no Node globals.
        files: ['src/renderer/**/*.ts'],
        rules: {
            'no-restricted-globals': [
                'error',
                'process',
                'require',
                '__dirname',
                '__filename',
                'Buffer',
            ],
        },
    },
    {
        // Shared code is inlined into every entry point, including the sandboxed preload:
        // it must not depend on Node or DOM specifics.
        files: ['src/shared/**/*.ts', 'src/preload/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [
                                'node:*',
                                'bugsplat',
                                'fs',
                                'path',
                                'os',
                                'child_process',
                                'url',
                            ],
                            message:
                                'Preload/shared code must be self-contained: sandboxed preloads can only require "electron".',
                        },
                    ],
                },
            ],
        },
    },
);
