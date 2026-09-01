import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

process.env.TZ = 'America/Los_Angeles'

export default defineConfig({
    resolve: {
        alias: [{ find: /^@\/(.*)$/, replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/$1` }],
    },
    test: {
        globals: true,
        setupFiles: ['../../tooling/vitest/setup-fake-timers.ts'],
        clearMocks: true,
        silent: true,
        pool: 'forks',
        exclude: [...configDefaults.exclude, 'src/__tests__/utils/**'],
        coverage: {
            enabled: true,
            provider: 'v8',
            reportsDirectory: 'coverage',
        },
    },
})
