import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
    test: {
        globals: true,
        clearMocks: true,
        fakeTimers: { shouldAdvanceTime: true },
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
        exclude: ['**/node_modules/**', 'src/__tests__/utils/**'],
    },
})
