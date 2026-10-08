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
        environment: 'node',
        exclude: [...configDefaults.exclude, 'dist/**'],
    },
})
