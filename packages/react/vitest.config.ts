import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: [
            { find: /^@\/(.*)$/, replacement: `${fileURLToPath(new URL('../core/src', import.meta.url))}/$1` },
            {
                find: /^@posthog\/browser-common\/utils\/(.*)$/,
                replacement: `${fileURLToPath(new URL('../browser-common/src/utils', import.meta.url))}/$1.ts`,
            },
            {
                find: /^@posthog\/browser-common\/(.*)$/,
                replacement: `${fileURLToPath(new URL('../browser-common/src', import.meta.url))}/$1.ts`,
            },
            {
                find: '@posthog/browser-common',
                replacement: fileURLToPath(new URL('../browser-common/src/index.ts', import.meta.url)),
            },
            {
                find: '@posthog/core/surveys',
                replacement: fileURLToPath(new URL('../core/src/surveys/index.ts', import.meta.url)),
            },
            { find: '@posthog/core', replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
            {
                find: 'posthog-js',
                replacement: fileURLToPath(
                    new URL('../browser/src/entrypoints/module.no-external.es.ts', import.meta.url)
                ),
            },
        ],
    },
    test: {
        globals: true,
        clearMocks: true,
        setupFiles: ['./vitest.setup.ts'],
        environment: 'jsdom',
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        exclude: [...configDefaults.exclude, 'dist/**'],
    },
})
