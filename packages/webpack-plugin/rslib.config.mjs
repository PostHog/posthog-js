import { defineConfig } from '@rslib/core'

export default defineConfig({
    dts: true,
    bundle: false,
    shims: { esm: { __dirname: true } },
    syntax: 'es6',
    lib: [{ format: 'esm' }, { format: 'cjs' }],
    source: {
        entry: {
            index: 'src/index.ts',
            config: 'src/config.ts',
        },
        tsconfigPath: './tsconfig.build.json',
    },
})
