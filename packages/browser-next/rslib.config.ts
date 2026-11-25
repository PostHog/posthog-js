import { defineConfig } from '@rslib/core'
import { readFileSync } from 'node:fs'

const packageVersion = (
    JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
).version

// The rrweb workspace packages are never published to npm, so this module is bundled with them, as posthog-js
// bundles its recorder. Every other module is emitted unbundled.
const rrwebModule = 'src/products/session-recording/rrweb.ts'
const unbundled = {
    index: ['src/**/*', '!src/**/*.spec.ts', '!src/**/*.md', '!src/composition/script/**/*', `!${rrwebModule}`],
}
const bundled = { 'products/session-recording/rrweb': `./${rrwebModule}` }

export default defineConfig({
    lib: [
        { format: 'esm', syntax: 'es2023', dts: true, bundle: false, source: { entry: unbundled } },
        { format: 'cjs', syntax: 'es2023', dts: true, bundle: false, source: { entry: unbundled } },
        { format: 'esm', syntax: 'es2023', bundle: true, source: { entry: bundled } },
        { format: 'cjs', syntax: 'es2023', bundle: true, source: { entry: bundled } },
    ],
    source: {
        define: {
            __POSTHOG_BROWSER_VERSION__: JSON.stringify(packageVersion),
        },
        tsconfigPath: './tsconfig.build.json',
    },
})
