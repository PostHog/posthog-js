import { external, plugins, resolve, dts } from '@posthog-tooling/rollup-utils'
import packageJson from './package.json' with { type: 'json' }

const configs = []
const extensions = ['.ts', '.tsx', '.js', '.jsx']

configs.push({
  input: `./src/index.ts`,
  output: [
    {
      file: packageJson.main,
      sourcemap: true,
      exports: 'named',
      format: `cjs`,
    },
    {
      file: packageJson.module,
      sourcemap: true,
      format: `es`,
    },
  ],
  external: external(packageJson),
  plugins: plugins(extensions),
})

configs.push({
  input: `./src/index.ts`,
  output: [{ file: packageJson.types, format: 'es' }],
  external: external(packageJson),
  plugins: [resolve({ extensions }), dts({ tsconfig: `./tsconfig.json` })],
})

export default configs
