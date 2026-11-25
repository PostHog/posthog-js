import { defineConfig } from '@rslib/core'

export default defineConfig({
  lib: [
    { format: 'esm', syntax: 'es2023', dts: true, bundle: false },
    { format: 'cjs', syntax: 'es2023', dts: true, bundle: false },
  ],
  source: {
    entry: {
      index: ['src/**/*', '!src/__tests__/**/*', '!src/**/*.spec.ts', '!src/**/*.md'],
    },
    tsconfigPath: './tsconfig.build.json',
  },
  tools: {
    bundlerChain: (chain) => {
      // rslib's minifier drops the `webpackIgnore` magic comment, so leave the one file that needs it unminified.
      chain.optimization
        .minimizer('js')
        .tap(([options]) => [{ ...options, exclude: /react-renderer-import\.[cm]?js$/ }])
    },
  },
})
