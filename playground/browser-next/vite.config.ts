import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
    resolve: {
        alias: [
            {
                find: '@posthog/browser/analytics',
                replacement: fileURLToPath(new URL('../../packages/browser-next/src/analytics.ts', import.meta.url)),
            },
            {
                find: '@posthog/browser',
                replacement: fileURLToPath(new URL('../../packages/browser-next/src/index.ts', import.meta.url)),
            },
        ],
    },
    server: {
        fs: { allow: [repositoryRoot] },
        port: 5174,
    },
})
