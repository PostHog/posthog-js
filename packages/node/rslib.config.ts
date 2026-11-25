import { defineConfig } from '@rslib/core'

const REACT_RENDERER_IMPORT_FILE = /react-renderer-import\.[cm]?js$/

export default defineConfig({
  lib: [
    { format: 'esm', syntax: 'es2023', dts: true, bundle: false },
    { format: 'cjs', syntax: 'es2023', dts: true, bundle: false, shims: { cjs: { 'import.meta.url': false } } },
  ],
  source: {
    entry: {
      index: ['src/**/*', '!src/__tests__/**/*', '!src/**/*.spec.ts', '!src/**/*.md'],
    },
    tsconfigPath: './tsconfig.build.json',
  },
  tools: {
    bundlerChain: (chain) => {
      chain.optimization.minimizer('js').tap(([options]) => [{ ...options, exclude: REACT_RENDERER_IMPORT_FILE }])
    },
  },
})
