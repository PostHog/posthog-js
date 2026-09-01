import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: [{ find: /^@\/(.*)$/, replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/$1` }],
    },
    test: {
        globals: true,
        setupFiles: ['../../tooling/vitest/setup-fake-timers.ts'],
        clearMocks: true,
        silent: true,
        coverage: {
            enabled: true,
            provider: 'v8',
            reportsDirectory: 'coverage',
        },
    },
})
