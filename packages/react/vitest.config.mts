import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        clearMocks: true,
        environment: 'jsdom',
        include: ['src/**/*.test.{ts,tsx}'],
        exclude: ['**/node_modules/**', '**/dist/**'],
    },
})
