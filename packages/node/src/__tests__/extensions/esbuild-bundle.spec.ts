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

// A path that does not exist makes esbuild's own resolver fail, as in an app without the optional peer.
const withoutReactEmailRender = { '@react-email/render': './not-installed/@react-email/render' }

const builtEntrypoint = (file: string): string => {
  const entryPoint = fileURLToPath(new URL(`../../../dist/entrypoints/${file}`, import.meta.url))
  expect(existsSync(entryPoint)).toBe(true)
  return entryPoint
}

describe('esbuild bundle of the built package', () => {
  it.each(['index.node.mjs', 'index.node.js'])('bundles %s when no optional peer is installed', async (file) => {
    const result = await build({
      entryPoints: [builtEntrypoint(file)],
      bundle: true,
      platform: 'node',
      write: false,
      logLevel: 'silent',
      plugins: [withoutOpenTelemetry],
      alias: withoutReactEmailRender,
    })

    expect({ errors: result.errors, warnings: result.warnings }).toEqual({ errors: [], warnings: [] })
  })

  it.each([
    ['Convex', ['convex', 'module']],
    ['Cloudflare Workers', ['workerd', 'worker', 'browser']],
  ])('bundles index.edge.mjs for %s when @react-email/render is not installed', async (_runtime, conditions) => {
    const result = await build({
      entryPoints: [builtEntrypoint('index.edge.mjs')],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      conditions,
      write: false,
      logLevel: 'silent',
      alias: withoutReactEmailRender,
    })

    expect({ errors: result.errors, warnings: result.warnings }).toEqual({ errors: [], warnings: [] })
  })
})
