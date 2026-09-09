import { defineConfig, type UserConfig } from 'tsdown'

const commonConfig: UserConfig = {
  format: {
    cjs: { dts: false },
    esm: { dts: {} },
  },
  outDir: 'dist',
  clean: false,
  sourcemap: true,
  dts: true,
  target: 'node20',
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
}

const providers = [
  'anthropic',
  'openai',
  'vercel',
  'langchain',
  'langchain/middleware',
  'gemini',
  'otel',
  'openai-agents',
  'adk',
]

export default defineConfig([
  {
    ...commonConfig,
    entry: { index: 'src/index.ts' },
  },
  ...providers.map((provider) => ({
    ...commonConfig,
    entry: { [`${provider}/index`]: `src/${provider}/index.ts` },
  })),
])
