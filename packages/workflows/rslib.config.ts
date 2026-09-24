import { defineConfig } from '@rslib/core'

export default defineConfig({
    lib: [{ format: 'esm', syntax: 'es2022', dts: true, bundle: false }],
    output: {
        target: 'node',
    },
    source: {
        entry: {
            index: ['src/**/*', '!src/__tests__/**/*'],
        },
        tsconfigPath: './tsconfig.build.json',
    },
})
