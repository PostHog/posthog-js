import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: [
            { find: /^@\/(.*)$/, replacement: `${fileURLToPath(new URL('../core/src', import.meta.url))}/$1` },
            { find: /^@posthog\/core$/, replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
            {
                find: /^@posthog\/react$/,
                replacement: fileURLToPath(new URL('../react/src/index.ts', import.meta.url)),
            },
            {
                find: /^posthog-js$/,
                replacement: fileURLToPath(
                    new URL('../browser/src/entrypoints/module.no-external.es.ts', import.meta.url)
                ),
            },
            {
                find: /^posthog-node\/edge$/,
                replacement: fileURLToPath(new URL('../node/src/entrypoints/index.edge.ts', import.meta.url)),
            },
            {
                find: /^posthog-node$/,
                replacement: fileURLToPath(new URL('../node/src/entrypoints/index.node.ts', import.meta.url)),
            },
        ],
    },
    test: {
        globals: true,
        clearMocks: true,
        environment: 'jsdom',
        environmentOptions: {
            jsdom: {
                url: 'http://localhost',
            },
        },
        include: ['tests/**/*.test.{ts,tsx}'],
        setupFiles: ['./tests/setup.ts'],
        coverage: {
            enabled: true,
            provider: 'v8',
            reportsDirectory: 'coverage',
        },
    },
})
