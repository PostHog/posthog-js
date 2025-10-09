import { defineConfig } from '@rslib/core'

export default defineConfig({
  lib: [
    { format: 'esm', syntax: 'es2023', dts: true, bundle: false },
    { format: 'cjs', syntax: 'es2023', dts: true, bundle: false },
  ],
  source: {
    entry: {
      index: ['src/**/*', '!src/__tests__/**/*', '!src/**/*.spec.ts'],
    },
    tsconfigPath: './tsconfig.build.json',
  },
})
