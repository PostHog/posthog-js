import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        clearMocks: true,
        environment: 'node',
        coverage: {
            enabled: true,
            provider: 'v8',
            reportsDirectory: 'coverage',
        },
    },
})
