import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        {
            // The SDK's rollup build turns `import styles from './survey.css'` into a
            // JS string default export; vite only does that with the ?inline suffix.
            name: 'sdk-css-as-string',
            enforce: 'pre',
            async resolveId(source, importer, options) {
                if (source.endsWith('.css') && importer?.includes('/packages/browser/src/')) {
                    const resolved = await this.resolve(source, importer, { skipSelf: true, ...options })
                    if (resolved) {
                        return resolved.id + '?inline'
                    }
                }
            },
        },
        preact(),
    ],
    resolve: {
        // The SDK source imported via ../../src must use this workspace's preact,
        // not the repo root's copy — two preact instances break hooks.
        dedupe: ['preact'],
    },
})
