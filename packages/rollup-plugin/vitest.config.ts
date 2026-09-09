import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            '@posthog/plugin-utils': fileURLToPath(new URL('../plugin-utils/src/index.ts', import.meta.url)),
        },
    },
    test: {
        globals: true,
        clearMocks: true,
        silent: true,
        exclude: [...configDefaults.exclude, 'test/**'],
        coverage: {
            enabled: true,
            provider: 'v8',
            reportsDirectory: 'coverage',
        },
    },
})
