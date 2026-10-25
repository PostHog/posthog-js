import { build, type Plugin } from 'esbuild'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Acts as if the optional `@opentelemetry/api` peer is not installed.
const withoutOpenTelemetry: Plugin = {
  name: 'without-opentelemetry',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@opentelemetry\// }, (args) => ({
      errors: [{ text: `Could not resolve "${args.path}"` }],
    }))
  },
}

describe('esbuild bundle of the built package', () => {
  it.each(['index.node.mjs', 'index.node.js'])('bundles %s when @opentelemetry/api is not installed', async (file) => {
    const entryPoint = fileURLToPath(new URL(`../../../dist/entrypoints/${file}`, import.meta.url))
    expect(existsSync(entryPoint)).toBe(true)

    const result = await build({
      entryPoints: [entryPoint],
      bundle: true,
      platform: 'node',
      write: false,
      logLevel: 'silent',
      plugins: [withoutOpenTelemetry],
    })

    expect(result.errors).toEqual([])
  })
})
