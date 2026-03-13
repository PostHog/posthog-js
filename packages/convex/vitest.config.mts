import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
    test: {
        globals: true,
        clearMocks: true,
        fakeTimers: { shouldAdvanceTime: true },
        include: ['src/**/*.test.ts'],
        exclude: ['**/node_modules/**'],
        alias: {
            '@posthog/convex/test': path.resolve(__dirname, 'src/test'),
            '@posthog/convex/convex.config.js': path.resolve(__dirname, 'dist/component/convex.config'),
            '@posthog/convex/convex.config': path.resolve(__dirname, 'dist/component/convex.config'),
            '@posthog/convex': path.resolve(__dirname, 'src/client/index'),
        },
    },
})
