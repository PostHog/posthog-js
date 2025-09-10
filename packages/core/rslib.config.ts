import { defineConfig } from '@rslib/core'

export default defineConfig({
  lib: [
    { format: 'esm', syntax: 'es6', dts: true, bundle: false },
    { format: 'cjs', syntax: 'es6', dts: true, bundle: false },
  ],
})
