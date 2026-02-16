import { external, babel, resolve, commonjs, json, dts, plugins } from '@posthog-tooling/rollup-utils'
import packageJson from './package.json' with { type: 'json' }

const configs = []
const extensions = ['.js', '.jsx', '.ts', '.tsx']
const externalDeps = external(packageJson)

configs.push({
  input: `./src/index.ts`,
  output: [
    {
      file: packageJson.main,
      sourcemap: true,
      exports: 'named',
      format: `cjs`,
      interop: 'auto',
    },
    {
      file: packageJson.module,
      sourcemap: true,
      format: `es`,
    },
  ],
  external: externalDeps,
  plugins: plugins(extensions),
})

configs.push({
  input: `./src/index.ts`,
  output: [{ file: `./dist/index.d.ts`, format: 'es' }],
  external: externalDeps,
  plugins: [resolve({ extensions }), dts()],
})

// Add submodule builds for posthog-ai
const providers = ['anthropic', 'openai', 'vercel', 'langchain', 'gemini', 'otel']

providers.forEach((provider) => {
  configs.push({
    input: `./src/${provider}/index.ts`,
    output: [
      {
        file: `./dist/${provider}/index.cjs`,
        sourcemap: true,
        exports: 'named',
        format: 'cjs',
        interop: 'auto',
      },
      {
        file: `./dist/${provider}/index.mjs`,
        sourcemap: true,
        format: 'es',
      },
    ],
    external: externalDeps,
    plugins: [
      resolve({ extensions }),
      commonjs(),
      json(),
      babel({
        extensions,
        babelHelpers: 'bundled',
        include: ['./src/**/*.{js,jsx,ts,tsx}'],
        presets: [['@babel/preset-env', { targets: { node: '20.0' } }], '@babel/preset-typescript'],
      }),
    ],
  })

  configs.push({
    input: `./src/${provider}/index.ts`,
    output: [{ file: `./dist/${provider}/index.d.ts`, format: 'es' }],
    external: externalDeps,
    plugins: [resolve({ extensions }), dts()],
  })
})

export default configs
