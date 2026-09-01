import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            'posthog-js': fileURLToPath(new URL('../browser/src/entrypoints/module.no-external.es.ts', import.meta.url)),
        },
    },
    test: {
        globals: true,
        clearMocks: true,
        environment: 'jsdom',
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        exclude: [...configDefaults.exclude, 'dist/**'],
    },
})
