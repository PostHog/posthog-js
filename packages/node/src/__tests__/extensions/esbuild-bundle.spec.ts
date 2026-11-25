import { rspack } from '@rslib/core'
import { build, type Platform, type Plugin } from 'esbuild'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
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
      ['posthog-node', 'Cloudflare Workers', ['workerd', 'worker', 'browser']],
      ['posthog-node/edge', 'Cloudflare Workers edge subpath', ['workerd', 'worker', 'browser']],
      ['posthog-node', 'Convex', ['convex', 'module']],
    ])(
      'loads require("%s") for %s bundled to ESM without dynamic require shims even with treeShaking disabled',
      async (specifier, _runtime, conditions) => {
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

    it('returns missing_react_renderer in a real isolated bundle without reactEmailRenderer and renders with module or wrapper', async () => {
      const requests: Array<{ method?: string; url?: string }> = []
      const sent: Array<{ html: string; text: string }> = []
      const server = createServer((req, res) => {
        requests.push({ method: req.method, url: req.url })
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          if (
            req.url !== '/api/messaging/send/email/' ||
            req.method !== 'POST' ||
            req.headers.authorization !== 'Bearer phs_test' ||
            req.headers['content-type'] !== 'application/json' ||
            typeof req.headers['idempotency-key'] !== 'string' ||
            req.headers['idempotency-key'].length === 0
          ) {
            res.statusCode = 400
            res.setHeader('Connection', 'close')
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ code: 'invalid_request', detail: 'unexpected send request' }))
            return
          }
          sent.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          res.statusCode = 200
          res.setHeader('Connection', 'close')
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ message_id: '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b', replayed: false, warnings: [] }))
        })
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo

      try {
        const runIsolatedSend = async (mode: 'none' | 'none-throwing-warn' | 'module' | 'wrapper') => {
          requests.length = 0
          sent.length = 0
          const importLine =
            mode === 'module'
              ? "import * as reactEmailRenderer from '@react-email/render'"
              : mode === 'wrapper'
                ? "import { render, toPlainText } from '@react-email/render'\nconst reactEmailRenderer = { render: (el) => render(el, { pretty: true }), toPlainText }"
                : ''
          const warnSetup =
            mode === 'none'
              ? 'console.warn = (...args) => { warnings.push(args.map(String).join(" ")) }'
              : mode === 'none-throwing-warn'
                ? 'console.warn = () => { throw new Error("broken warning sink") }'
                : ''
          const contents = `
            import { createElement } from 'react'
            import { PostHog } from 'posthog-node'
            ${importLine}
            export async function run() {
              const warnings = []
              const originalWarn = console.warn
              ${warnSetup}
              try {
                const client = new PostHog('phc_test', {
                  host: 'https://us.i.posthog.com',
                  appHost: ${JSON.stringify(`http://127.0.0.1:${port}`)},
                  secretKey: 'phs_test',
                  enableLocalEvaluation: false,
                  ${mode === 'none' || mode === 'none-throwing-warn' ? '' : 'reactEmailRenderer,'}
                })
                ${mode === 'none' || mode === 'none-throwing-warn' ? 'client.debug(true)' : ''}
                const response = await client.emails.send({
                  to: 'ada@example.com',
                  templateKey: 'welcome',
                  subject: 'Welcome',
                  react: createElement('p', null, 'Welcome, Ada'),
                })
                return {
                  warnings,
                  data: response.data,
                  error: response.error ? { code: response.error.code, fix: response.error.fix } : null,
                }
              } finally {
                console.warn = originalWarn
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
          const outcome = await mod.run()
          return { ...outcome, requests: [...requests], sent: [...sent] }
        }

        const withoutOpt = await runIsolatedSend('none')
        expect(withoutOpt.data).toBeNull()
        expect(withoutOpt.requests).toEqual([])
        expect(withoutOpt.error).toMatchObject({
          code: 'missing_react_renderer',
          fix: expect.stringContaining('reactEmailRenderer'),
        })
        expect(withoutOpt.warnings).toEqual([
          expect.stringMatching(
            /missing_react_renderer[\s\S]*reactEmailRenderer: await import\('@react-email\/render'\)/
          ),
        ])

        const withThrowingWarn = await runIsolatedSend('none-throwing-warn')
        expect(withThrowingWarn.data).toBeNull()
        expect(withThrowingWarn.requests).toEqual([])
        expect(withThrowingWarn.error).toMatchObject({
          code: 'missing_react_renderer',
          fix: expect.stringContaining('reactEmailRenderer'),
        })

        const withModule = await runIsolatedSend('module')
        expect(withModule.error).toBeNull()
        expect(withModule.requests).toHaveLength(1)
        expect(withModule.sent).toEqual([
          expect.objectContaining({
            html: expect.stringContaining('<p>Welcome, Ada</p>'),
            text: 'Welcome, Ada',
          }),
        ])

        const withWrapper = await runIsolatedSend('wrapper')
        expect(withWrapper.error).toBeNull()
        expect(withWrapper.requests).toHaveLength(1)
        expect(withWrapper.sent).toEqual([
          expect.objectContaining({
            html: expect.stringContaining('\n'),
            text: 'Welcome, Ada',
          }),
        ])
        expect(withWrapper.sent[0].html).toContain('<p>Welcome, Ada</p>')
      } finally {
        const closed = new Promise<void>((resolve) => server.close(() => resolve()))
        server.closeAllConnections()
        await closed
      }
    }, 20_000)

    it('exits cleanly under strict unhandled rejections when toPlainText returns a same-realm, cross-realm, or async-throwing thenable', async () => {
      const nodeEntryUrl = pathToFileURL(builtEntrypoint('index.node.mjs')).href
      let receivedRequests = 0
      const server = createServer((_req, res) => {
        receivedRequests += 1
        res.statusCode = 500
        res.end('unexpected request')
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo

      try {
        const script = `
          import { createElement } from 'react'
          import vm from 'node:vm'
          import { PostHog } from ${JSON.stringify(nodeEntryUrl)}
          const runCase = async (toPlainText) => {
            const client = new PostHog('phc_test', {
              host: 'https://us.i.posthog.com',
              appHost: ${JSON.stringify(`http://127.0.0.1:${port}`)},
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
          const crossRealmPromise = await runCase(() =>
            vm.runInNewContext('Promise.reject(new Error("cross-realm failure"))')
          )
          const throwingThenable = await runCase(() => ({
            async then() {
              throw new Error('throwing thenable')
            },
          }))
          console.log(JSON.stringify({ rejectingPromise, crossRealmPromise, throwingThenable }))
        `
        const { stdout } = await execFileAsync(
          process.execPath,
          ['--unhandled-rejections=throw', '--input-type=module', '-e', script],
          { cwd: packageRoot }
        )
        expect(receivedRequests).toBe(0)
        expect(JSON.parse(stdout.trim())).toEqual({
          rejectingPromise: { data: null, code: 'react_render_failed' },
          crossRealmPromise: { data: null, code: 'react_render_failed' },
          throwingThenable: { data: null, code: 'react_render_failed' },
        })
      } finally {
        const closed = new Promise<void>((resolve) => server.close(() => resolve()))
        server.closeAllConnections()
        await closed
      }
    }, 20_000)

    it.each([
      ['ESM', `import { PostHog } from 'posthog-node'\nexport const client = new PostHog('phc_test')\n`],
      ['CJS', `const { PostHog } = require('posthog-node')\nmodule.exports = { client: new PostHog('phc_test') }\n`],
    ])(
      'leaves @react-email/render out of a webpack-compatible rspack %s bundle with no warnings and bundles it on opt-in',
      async (format, noOptCode) => {
        const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'posthog-node-rspack-'))
        try {
          mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true })
          symlinkSync(packageRoot, path.join(tmpDir, 'node_modules', 'posthog-node'), 'dir')
          const runRspack = async (name: string, contents: string) => {
            const entry = path.join(tmpDir, `${name}.${format === 'ESM' ? 'mjs' : 'cjs'}`)
            writeFileSync(entry, contents)
            const compiler = rspack({
              mode: 'production',
              target: 'webworker',
              context: tmpDir,
              entry,
              output: { path: path.join(tmpDir, `out-${name}`), filename: 'bundle.js' },
              performance: { hints: false },
              resolve: {
                conditionNames: ['workerd', 'worker', 'browser', format === 'ESM' ? 'import' : 'require', 'default'],
                modules: [path.join(tmpDir, 'node_modules'), path.join(packageRoot, 'node_modules'), 'node_modules'],
              },
            })
            const stats = await new Promise<NonNullable<Parameters<Parameters<typeof compiler.run>[0]>[1]>>(
              (resolve, reject) => {
                compiler.run((err, s) => {
                  compiler.close(() => {
                    if (err || !s) reject(err ?? new Error('missing rspack stats'))
                    else resolve(s)
                  })
                })
              }
            )
            const json = stats.toJson({ modules: true, warnings: true, errors: true })
            const modules = (json.modules ?? []).map((m) => m.nameForCondition ?? m.name ?? '')
            return {
              errors: json.errors ?? [],
              warnings: json.warnings ?? [],
              hasRenderer: modules.some((m) => m.includes('@react-email/render')),
            }
          }

          const withoutOpt = await runRspack('no-opt', noOptCode)
          expect({
            errors: withoutOpt.errors,
            warnings: withoutOpt.warnings,
            hasRenderer: withoutOpt.hasRenderer,
          }).toEqual({ errors: [], warnings: [], hasRenderer: false })

          const optInCode =
            format === 'ESM'
              ? `import { PostHog } from 'posthog-node'\nimport * as reactEmailRenderer from '@react-email/render'\nexport const client = new PostHog('phc_test', { reactEmailRenderer })\n`
              : `const { PostHog } = require('posthog-node')\nconst reactEmailRenderer = require('@react-email/render')\nmodule.exports = { client: new PostHog('phc_test', { reactEmailRenderer }) }\n`
          const withOpt = await runRspack('opt-in', optInCode)
          expect({ errors: withOpt.errors, warnings: withOpt.warnings, hasRenderer: withOpt.hasRenderer }).toEqual({
            errors: [],
            warnings: [],
            hasRenderer: true,
          })
        } finally {
          rmSync(tmpDir, { recursive: true, force: true })
        }
      },
      20_000
    )

    it('passes Vite import-analysis without warnings and leaves @react-email/render out of a Vite SSR bundle unless opted in', async () => {
      const pkgRequire = createRequire(path.join(packageRoot, 'package.json'))
      const vitestRequire = createRequire(pkgRequire.resolve('vitest'))
      const viteEntry = vitestRequire.resolve('vite').replace(/index\.cjs$/, 'dist/node/index.js')
      const vite = (await import(pathToFileURL(viteEntry).href)) as {
        createServer: (config: Record<string, unknown>) => Promise<{
          ssrLoadModule: (url: string) => Promise<Record<string, unknown>>
          close: () => Promise<void>
        }>
        build: (
          config: Record<string, unknown>
        ) => Promise<
          | { output?: Array<{ modules?: Record<string, unknown> }> }
          | Array<{ output?: Array<{ modules?: Record<string, unknown> }> }>
        >
      }

      const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'posthog-node-vite-'))
      try {
        mkdirSync(path.join(tmpDir, 'node_modules', '@react-email'), { recursive: true })
        symlinkSync(packageRoot, path.join(tmpDir, 'node_modules', 'posthog-node'), 'dir')
        symlinkSync(
          path.join(packageRoot, 'node_modules', '@react-email', 'render'),
          path.join(tmpDir, 'node_modules', '@react-email', 'render'),
          'dir'
        )

        const makeLogger = (warnings: string[]) => ({
          info() {},
          warn(msg: string) {
            warnings.push(String(msg))
          },
          warnOnce(msg: string) {
            warnings.push(String(msg))
          },
          error(msg: string) {
            warnings.push(`ERROR: ${String(msg)}`)
          },
          clearScreen() {},
          hasErrorLogged() {
            return false
          },
          hasWarned: false,
        })

        const analysisWarnings: string[] = []
        writeFileSync(
          path.join(tmpDir, 'ssr-entry.mjs'),
          `import { PostHog } from 'posthog-node'\nexport const client = new PostHog('phc_test', { enableLocalEvaluation: false })\n`
        )
        const server = await vite.createServer({
          root: tmpDir,
          configFile: false,
          logLevel: 'silent',
          optimizeDeps: { noDiscovery: true, include: [] },
          ssr: { noExternal: ['posthog-node'] },
          server: { middlewareMode: true, ws: false, watch: null },
          customLogger: makeLogger(analysisWarnings),
        })
        try {
          const loaded = await server.ssrLoadModule('/ssr-entry.mjs')
          expect(loaded.client).toBeDefined()
        } finally {
          await server.close()
        }
        expect(analysisWarnings).toEqual([])

        const runViteSsrBuild = async (name: string, contents: string) => {
          const entry = path.join(tmpDir, `${name}.mjs`)
          writeFileSync(entry, contents)
          const warnings: string[] = []
          const res = await vite.build({
            root: tmpDir,
            configFile: false,
            logLevel: 'silent',
            customLogger: makeLogger(warnings),
            ssr: { noExternal: ['posthog-node', '@react-email/render'] },
            build: {
              ssr: entry,
              outDir: path.join(tmpDir, `dist-${name}`),
              rollupOptions: {
                onwarn(w: { message?: string }) {
                  warnings.push(w.message ?? String(w))
                },
              },
            },
          })
          const outputs = (Array.isArray(res) ? res : [res]).flatMap((r) => r.output ?? [])
          const modules = outputs.flatMap((chunk) => Object.keys(chunk.modules ?? {}))
          return {
            warnings,
            hasRenderer: modules.some((m) => m.includes('@react-email/render')),
          }
        }

        const withoutOpt = await runViteSsrBuild(
          'no-opt',
          `import { PostHog } from 'posthog-node'\nexport const client = new PostHog('phc_test')\n`
        )
        expect(withoutOpt).toEqual({ warnings: [], hasRenderer: false })

        const withOpt = await runViteSsrBuild(
          'opt-in',
          `import { PostHog } from 'posthog-node'\nimport * as reactEmailRenderer from '@react-email/render'\nexport const client = new PostHog('phc_test', { reactEmailRenderer })\n`
        )
        expect(withOpt).toEqual({ warnings: [], hasRenderer: true })
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    }, 20_000)
  })

  it.each([
    { runtime: 'default runtime', platform: 'browser' as const, library: 'posthog-edge' },
    { runtime: '"use node" runtime', platform: 'node' as const, library: 'posthog-node' },
  ])('gives a Convex function in the $runtime the $library client', async ({ platform, library }) => {
    expect(await libraryBundledByConvex(platform)).toBe(library)
  })
})
