import { defineConfig } from '@rslib/core'
import { readFileSync } from 'node:fs'

const packageVersion = (
    JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
).version

export default defineConfig({
    lib: [
        { format: 'esm', syntax: 'es2023', dts: true, bundle: false },
        { format: 'cjs', syntax: 'es2023', dts: true, bundle: false },
    ],
    source: {
        define: {
            __BROWSER_COMMON_VERSION__: JSON.stringify(packageVersion),
        },
        entry: {
            index: ['src/**/*', '!src/__tests__/**/*', '!src/**/*.spec.ts'],
        },
        tsconfigPath: './tsconfig.build.json',
    },
})
