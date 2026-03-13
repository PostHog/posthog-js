import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        clearMocks: true,
        environment: 'jsdom',
        environmentOptions: {
            jsdom: {
                url: 'http://localhost',
            },
        },
        setupFiles: ['./functional_tests/setup.ts'],
        include: ['functional_tests/**/*.test.ts'],
        exclude: ['**/node_modules/**'],
    },
})
