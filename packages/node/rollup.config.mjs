import { plugins, external, resolve, dts } from '@posthog-tooling/rollup-utils'
import packageJson from './package.json' with { type: 'json' }

const runtimes = ['node', 'edge']
const configs = []
const extensions = ['.ts', '.js']

runtimes.forEach((runtime) => {
  configs.push({
    input: `./src/entrypoints/index.${runtime}.ts`,
    output: [
      {
        file: `./dist/${runtime}/index.cjs`,
        sourcemap: true,
        exports: 'named',
        format: 'cjs',
      },
      {
        file: `./dist/${runtime}/index.mjs`,
        sourcemap: true,
        format: 'es',
      },
    ],
    external: external(packageJson),
    plugins: plugins(extensions),
  })
})

configs.push({
  input: `./src/entrypoints/index.node.ts`,
  output: [{ file: `./dist/index.d.ts`, format: 'es' }],
  external: external(packageJson),
  plugins: [resolve({ extensions }), dts({ tsconfig: './tsconfig.json' })],
})

export default configs
