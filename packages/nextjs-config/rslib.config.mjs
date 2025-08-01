import { defineConfig } from '@rslib/core'

export default defineConfig({
  source: {
    root: 'src',
    include: ['**/*'],
    exclude: ['**/*.spec.ts'],
  },
  dts: true,
  bundle: false,
  shims: { esm: { __dirname: true } },
  syntax: 'es6',
  lib: [{ format: 'esm' }, { format: 'cjs' }],
})
