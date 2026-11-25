import { build, type Platform, type Plugin } from 'esbuild'
import { existsSync, readFileSync } from 'node:fs'
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

  describe('when @react-email/render is installed', () => {
    const bundledPackages = async (contents: string, platform: Platform, conditions: string[]): Promise<string[]> => {
      const result = await build({
        stdin: { contents, resolveDir: packageRoot },
        bundle: true,
        platform,
        format: 'esm',
        conditions,
        external: ['node:*'],
        write: false,
        metafile: true,
        logLevel: 'silent',
        plugins: [withoutOpenTelemetry],
      })
      return Object.keys(result.metafile.inputs)
    }
    const fromReactEmailRender = (input: string): boolean => input.includes('/@react-email/render/')

    it.each([
      ['Node', 'node' as const, []],
      ['Cloudflare Workers', 'browser' as const, ['workerd', 'worker', 'browser']],
    ])('leaves it out of a %s bundle that does not pass reactEmailRenderer', async (_runtime, platform, conditions) => {
      const inputs = await bundledPackages(
        `import { PostHog } from 'posthog-node'\nexport const client = new PostHog('phc_test')`,
        platform,
        conditions
      )

      expect(inputs.filter(fromReactEmailRender)).toEqual([])
    })

    it('bundles it when the app passes it as reactEmailRenderer', async () => {
      const inputs = await bundledPackages(
        `import { PostHog } from 'posthog-node'\nimport * as reactEmailRenderer from '@react-email/render'\nexport const client = new PostHog('phc_test', { reactEmailRenderer })`,
        'browser',
        ['workerd', 'worker', 'browser']
      )

      expect(inputs.some(fromReactEmailRender)).toBe(true)
    })

    it.each(['react-renderer-import.mjs', 'react-renderer-import.js'])(
      'keeps the comments that tell webpack and Vite to skip the import in %s',
      (file) => {
        const built = readFileSync(fileURLToPath(new URL(`../../../dist/emails/${file}`, import.meta.url)), 'utf8')

        expect(built).toContain('import(/* webpackIgnore: true */ /* @vite-ignore */ REACT_RENDERER_PACKAGE)')
      }
    )
  })

  it.each([
    { runtime: 'default runtime', platform: 'browser' as const, library: 'posthog-edge' },
    { runtime: '"use node" runtime', platform: 'node' as const, library: 'posthog-node' },
  ])('gives a Convex function in the $runtime the $library client', async ({ platform, library }) => {
    expect(await libraryBundledByConvex(platform)).toBe(library)
  })
})
