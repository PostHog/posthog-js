import { build, type Platform, type Plugin } from 'esbuild'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../../', import.meta.url))

// Acts as if the optional `@opentelemetry/api` peer is not installed.
const withoutOpenTelemetry: Plugin = {
  name: 'without-opentelemetry',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@opentelemetry\// }, (args) => ({
      errors: [{ text: `Could not resolve "${args.path}"` }],
    }))
  },
}

const withoutReactEmailRender = { '@react-email/render': './not-installed/@react-email/render' }

async function libraryBundledByConvex(platform: Platform): Promise<string> {
  const result = await build({
    stdin: {
      contents: `import { PostHog } from 'posthog-node'\nexport const library = PostHog.prototype.getLibraryId()`,
      resolveDir: packageRoot,
    },
    bundle: true,
    platform,
    format: 'esm',
    conditions: ['convex', 'module'],
    external: ['node:async_hooks'],
    write: false,
    logLevel: 'silent',
  })
  const bundle = Buffer.from(result.outputFiles[0].text).toString('base64')
  const { library } = await import(`data:text/javascript;base64,${bundle}`)
  return library
}

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

  it.each([
    { runtime: 'default runtime', platform: 'browser' as const, library: 'posthog-edge' },
    { runtime: '"use node" runtime', platform: 'node' as const, library: 'posthog-node' },
  ])('gives a Convex function in the $runtime the $library client', async ({ platform, library }) => {
    expect(await libraryBundledByConvex(platform)).toBe(library)
  })
})
