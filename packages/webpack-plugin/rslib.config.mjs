import { defineConfig } from '@rslib/core'

export default defineConfig({
    dts: true,
    bundle: false,
    syntax: 'es6',
    lib: [{ format: 'esm' }, { format: 'cjs' }],
})
