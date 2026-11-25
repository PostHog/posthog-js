import { build, type Platform, type Plugin } from 'esbuild'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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
      return Object.values(result.metafile.outputs).flatMap((output) =>
        Object.entries(output.inputs)
          .filter(([, meta]) => meta.bytesInOutput > 0)
          .map(([input]) => input)
      )
    }
    const fromReactEmailRender = (input: string): boolean => input.includes('/@react-email/render/')

    it.each([
      ['Node', 'node' as const, []],
      ['Cloudflare Workers', 'browser' as const, ['workerd', 'worker', 'browser']],
      ['Convex', 'browser' as const, ['convex', 'module']],
      ['Convex "use node"', 'node' as const, ['convex', 'module']],
    ])('leaves it out of a %s bundle that does not pass reactEmailRenderer', async (_runtime, platform, conditions) => {
      const inputs = await bundledPackages(
        `import { PostHog } from 'posthog-node'\nexport const client = new PostHog('phc_test')`,
        platform,
        conditions
      )

      expect(inputs.filter(fromReactEmailRender)).toEqual([])
    })

    it.each([
      ['Cloudflare Workers', 'browser' as const, ['workerd', 'worker', 'browser']],
      ['Convex', 'browser' as const, ['convex', 'module']],
      ['Convex "use node"', 'node' as const, ['convex', 'module']],
    ])('bundles it for %s when the app passes it as reactEmailRenderer', async (_runtime, platform, conditions) => {
      const inputs = await bundledPackages(
        `import { PostHog } from 'posthog-node'\nimport * as reactEmailRenderer from '@react-email/render'\nexport const client = new PostHog('phc_test', { reactEmailRenderer })`,
        platform,
        conditions
      )

      expect(inputs.some(fromReactEmailRender)).toBe(true)
    })

    it.each([
      ['Cloudflare Workers', 'posthog-node', ['workerd', 'worker', 'browser']],
      ['Cloudflare Workers edge subpath', 'posthog-node/edge', ['workerd', 'worker', 'browser']],
      ['Convex', 'posthog-node', ['convex', 'module']],
    ])(
      'loads require("%s") bundled to ESM without dynamic require shims even with treeShaking disabled',
      async (_runtime, specifier, conditions) => {
        const result = await build({
          stdin: {
            contents: `const { PostHog } = require(${JSON.stringify(specifier)})\nexport const library = PostHog.prototype.getLibraryId()`,
            resolveDir: packageRoot,
          },
          bundle: true,
          platform: 'browser',
          format: 'esm',
          conditions,
          treeShaking: false,
          write: false,
          logLevel: 'silent',
        })
        const bundle = Buffer.from(result.outputFiles[0].text).toString('base64')
        const { library } = await import(`data:text/javascript;base64,${bundle}`)
        expect(library).toBe('posthog-edge')
      }
    )

    it('returns missing_react_renderer in a real isolated bundle without reactEmailRenderer and renders when passed', async () => {
      const runIsolatedSend = async (withRenderer: boolean) => {
        const contents = `
          import { createElement } from 'react'
          import { PostHog } from 'posthog-node'
          ${withRenderer ? "import * as reactEmailRenderer from '@react-email/render'" : ''}
          export async function run() {
            const sent = []
            const client = new PostHog('phc_test', {
              host: 'https://us.i.posthog.com',
              secretKey: 'phs_test',
              enableLocalEvaluation: false,
              ${withRenderer ? 'reactEmailRenderer,' : ''}
              fetch: async (url, init) => {
                if (
                  url !== 'https://us.posthog.com/api/messaging/send/email/' ||
                  init.method !== 'POST' ||
                  init.headers?.Authorization !== 'Bearer phs_test' ||
                  init.headers?.['Content-Type'] !== 'application/json' ||
                  typeof init.headers?.['Idempotency-Key'] !== 'string' ||
                  init.headers['Idempotency-Key'].length === 0
                ) {
                  return {
                    status: 400,
                    text: async () => JSON.stringify({ code: 'invalid_request', detail: 'unexpected send request' }),
                    json: async () => ({ code: 'invalid_request', detail: 'unexpected send request' }),
                  }
                }
                sent.push(JSON.parse(init.body))
                return {
                  status: 200,
                  text: async () => JSON.stringify({ message_id: '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b', replayed: false, warnings: [] }),
                  json: async () => ({ message_id: '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b', replayed: false, warnings: [] }),
                }
              },
            })
            const response = await client.emails.send({
              to: 'ada@example.com',
              templateKey: 'welcome',
              subject: 'Welcome',
              react: createElement('p', null, 'Welcome, Ada'),
            })
            return {
              sent,
              data: response.data,
              error: response.error ? { code: response.error.code, fix: response.error.fix } : null,
            }
          }
        `
        const result = await build({
          stdin: { contents, resolveDir: packageRoot },
          bundle: true,
          platform: 'browser',
          format: 'esm',
          conditions: ['workerd', 'worker', 'browser'],
          external: ['node:*'],
          write: false,
          logLevel: 'silent',
        })
        const bundle = Buffer.from(result.outputFiles[0].text).toString('base64')
        const mod = await import(`data:text/javascript;base64,${bundle}`)
        return mod.run()
      }

      const withoutOpt = await runIsolatedSend(false)
      expect(withoutOpt.data).toBeNull()
      expect(withoutOpt.sent).toEqual([])
      expect(withoutOpt.error).toMatchObject({
        code: 'missing_react_renderer',
        fix: expect.stringContaining('reactEmailRenderer'),
      })

      const withOpt = await runIsolatedSend(true)
      expect(withOpt.error).toBeNull()
      expect(withOpt.sent).toEqual([
        expect.objectContaining({
          html: expect.stringContaining('<p>Welcome, Ada</p>'),
          text: 'Welcome, Ada',
        }),
      ])
    })

    it('exits cleanly under strict unhandled rejections when toPlainText returns a rejecting promise or async-throwing thenable', async () => {
      const nodeEntryUrl = pathToFileURL(builtEntrypoint('index.node.mjs')).href
      const script = `
        import { createElement } from 'react'
        import { PostHog } from ${JSON.stringify(nodeEntryUrl)}
        const runCase = async (toPlainText) => {
          const client = new PostHog('phc_test', {
            host: 'https://us.i.posthog.com',
            secretKey: 'phs_test',
            enableLocalEvaluation: false,
            reactEmailRenderer: { render: async () => '<p>Hi</p>', toPlainText },
          })
          const res = await client.emails.send({
            to: 'ada@example.com',
            templateKey: 'welcome',
            subject: 'Welcome',
            react: createElement('p', null, 'Hi'),
          })
          return { data: res.data, code: res.error?.code ?? null }
        }
        const rejectingPromise = await runCase(async () => {
          throw new Error('async plain text failure')
        })
        const throwingThenable = await runCase(() => ({
          async then() {
            throw new Error('throwing thenable')
          },
        }))
        console.log(JSON.stringify({ rejectingPromise, throwingThenable }))
      `
      const { stdout } = await execFileAsync(
        process.execPath,
        ['--unhandled-rejections=throw', '--input-type=module', '-e', script],
        { cwd: packageRoot }
      )
      expect(JSON.parse(stdout.trim())).toEqual({
        rejectingPromise: { data: null, code: 'react_render_failed' },
        throwingThenable: { data: null, code: 'react_render_failed' },
      })
    })

    it.each(['react-renderer-import.mjs', 'react-renderer-import.js'])(
      'keeps the comments that tell webpack and Vite to skip the import in %s',
      (file) => {
        const built = readFileSync(fileURLToPath(new URL(`../../../dist/emails/${file}`, import.meta.url)), 'utf8')

        expect(built).toMatch(/import\(\s*\/\* webpackIgnore: true \*\/\s*\/\* @vite-ignore \*\//)
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
