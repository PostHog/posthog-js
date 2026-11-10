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

  it.each([
    { runtime: 'default runtime', platform: 'browser' as const, library: 'posthog-edge' },
    { runtime: '"use node" runtime', platform: 'node' as const, library: 'posthog-node' },
  ])('gives a Convex function in the $runtime the $library client', async ({ platform, library }) => {
    expect(await libraryBundledByConvex(platform)).toBe(library)
  })
})
