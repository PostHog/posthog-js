import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [preact()],
    resolve: {
        // The SDK source imported via ../../src must use this workspace's preact,
        // not the repo root's copy — two preact instances break hooks.
        dedupe: ['preact'],
    },
})
