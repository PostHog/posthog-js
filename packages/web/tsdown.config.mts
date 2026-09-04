import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  format: {
    cjs: { dts: false },
    esm: { dts: {} },
  },
  outDir: 'dist',
  clean: false,
  sourcemap: true,
  dts: true,
  target: 'es2020',
  checks: {
    pluginTimings: false,
  },
  deps: {
    neverBundle: true,
  },
  cjsDefault: false,
  outExtensions: ({ format }) => ({
    js: format === 'es' ? '.mjs' : '.cjs',
    dts: '.d.ts',
  }),
  outputOptions: {
    exports: 'named',
  },
})
