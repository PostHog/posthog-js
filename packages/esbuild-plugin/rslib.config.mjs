import { defineConfig } from '@rslib/core'

export default defineConfig({
    dts: true,
    bundle: false,
    syntax: 'es2020',
    lib: [{ format: 'esm' }],
    source: {
        entry: {
            index: 'src/index.ts',
        },
        tsconfigPath: './tsconfig.build.json',
    },
})
