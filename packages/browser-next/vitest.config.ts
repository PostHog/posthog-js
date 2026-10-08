import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            '@posthog/browser-common/tests/client-conformance': fileURLToPath(
                new URL('../browser-common/tests/helpers/client-conformance.ts', import.meta.url)
            ),
        },
    },
    test: {
        globals: true,
        clearMocks: true,
        environment: 'node',
        include: ['tests/**/*.spec.ts'],
        poolOptions: {
            threads: {
                singleThread: true,
            },
        },
    },
})
