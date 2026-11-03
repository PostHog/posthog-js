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

const otelConfig: UserConfig = {
  ...commonConfig,
  inputOptions: { resolve: { mainFields: ['module', 'main'] } },
  nodeProtocol: true,
  deps: {
    neverBundle: true,
    // Keep the API external so the application's tracer and this processor share context.
    alwaysBundle: [/^@opentelemetry\/(sdk-trace-base|core|resources|semantic-conventions)(\/|$)/],
    onlyBundle: [/^@opentelemetry\/(sdk-trace-base|core|resources|semantic-conventions)(\/|$)/],
  },
  outputOptions: {
    ...commonConfig.outputOptions,
    banner: '/*! Includes OpenTelemetry code. Copyright The OpenTelemetry Authors. Licensed under Apache-2.0. */',
  },
}

const providers = [
  'anthropic',
  'openai',
  'vercel',
  'langchain',
  'langchain/middleware',
  'gemini',
  'openai-agents',
  'adk',
  'claude-agent-sdk',
  'evaluations',
  'genkit',
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
  {
    ...otelConfig,
    entry: { 'otel/index': 'src/otel/index.ts' },
  },
  {
    ...otelConfig,
    entry: { 'otel/index.browser': 'src/otel/index.ts' },
    platform: 'browser',
    inputOptions: { platform: 'browser', resolve: { mainFields: ['module', 'main'] } },
    format: ['esm', 'cjs'],
    dts: false,
  },
])
