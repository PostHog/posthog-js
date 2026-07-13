// Regression test for PostHog/posthog-js#3005 — Nuxt module used to fail
// sourcemap upload when `ssr: false` because the `close` hook injected against
// nitro's reported `serverDir` even when no server bundle was produced
// (e.g. `nuxt generate`), causing the CLI to exit 1.
// Covers both branches: ssr:false must skip the server inject (but still
// upload outputDir) and ssr:true must still inject the server bundle.
//
// Portability: avoids `import('../src/module.ts')` because Node 20 (declared
// in package.json `engines`) cannot strip TS types. Instead reads module.ts
// as text and rewrites the TS-specific bits into a runnable function, the
// same approach used by vue-plugin.test.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Normalize CRLF → LF so the single-line and end-of-line regexes below work
// identically on Windows and POSIX checkouts.
const source = readFileSync(new URL('../src/module.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const executableSource = source
  // Strip every static import — all type-only or replaced by injected stubs below.
  .replace(/^import .*$/gm, '')
  // Strip `declare module '...' { ... }` augmentation blocks (type-only).
  .replace(/^declare module [^{]*\{[\s\S]+?^\}\n/gm, '')
  // Strip `interface Foo { ... }` and `export interface Foo { ... }` blocks.
  .replace(/^(?:export )?interface \w+ \{[\s\S]+?^\}\n/gm, '')
  // Strip `type X = ...` and `export type X = ...` single-line aliases.
  .replace(/^(?:export )?type \w+ = .*\n/gm, '')
  // Strip the generic on defineNuxtModule.
  .replace('defineNuxtModule<ModuleOptions>', 'defineNuxtModule')
  // Strip the specific TS annotations actually used in module.ts.
  .replace(/value\?: unknown/g, 'value')
  .replace(/\(directory: string, sourcemapsConfig: SourcemapsConfig\)/g, '(directory, sourcemapsConfig)')
  .replace(/\(args: string\[\]\)/g, '(args)')
  .replace(/\): string \{/g, ') {')
  .replace(/\): boolean \{/g, ') {')
  .replace(/let (outputDir|publicDir|serverDir): string \| undefined/g, 'let $1')
  .replace(/const processOptions: string\[\] = /g, 'const processOptions = ')
  // `import.meta.url` is not available inside `new Function`; the value is
  // only fed to stubbed createResolver/fileURLToPath which ignore it.
  .replace(/import\.meta\.url/g, "'file:///fake/module.ts'")
  // Turn the module's `export default` into a value the wrapper returns.
  .replace('export default defineNuxtModule(', 'return defineNuxtModule(')

function loadModule() {
  const spawnCalls = []
  const stubs = {
    defineNuxtModule: (config) => config,
    addPlugin: () => {},
    addServerPlugin: () => {},
    addImportsDir: () => {},
    createResolver: () => ({ resolve: (p) => p }),
    resolveBinaryPath: () => '/fake/posthog-cli',
    spawnLocal: async (bin, args) => {
      spawnCalls.push({ bin, args: [...args] })
      return { code: 0 }
    },
    fileURLToPath: (u) => u,
    dirname: (p) => p,
  }
  const factory = new Function(...Object.keys(stubs), executableSource)
  const mod = factory(...Object.values(stubs))
  return { mod, spawnCalls }
}

async function runLifecycle({ ssr }) {
  const { mod, spawnCalls } = loadModule()
  const hooks = {}
  const nuxt = {
    options: {
      dev: false,
      ssr,
      sourcemap: {},
      runtimeConfig: { public: {} },
    },
    hook(name, cb) {
      ;(hooks[name] ||= []).push(cb)
    },
  }

  await mod.setup(
    {
      host: 'https://us.i.posthog.com',
      publicKey: 'phc_test',
      debug: false,
      clientConfig: {},
      serverConfig: {},
      cliBinaryPath: '/fake/posthog-cli',
      sourcemaps: {
        enabled: true,
        personalApiKey: 'phx_test',
        projectId: '123',
      },
    },
    nuxt
  )

  // With `ssr: false` (client-only / SPA mode) Nitro still reports output
  // dirs, but no server bundle is produced and serverDir is never created on disk.
  for (const cb of hooks['nitro:init'] || []) {
    await cb({
      options: {
        output: {
          dir: '/build/.output',
          publicDir: '/build/.output/public',
          serverDir: '/build/.output/server',
        },
      },
    })
  }
  for (const cb of hooks['nitro:config'] || []) await cb({})
  for (const cb of hooks['build:before'] || []) await cb()
  for (const cb of hooks['nitro:build:public-assets'] || []) await cb()
  for (const cb of hooks['close'] || []) await cb()

  return spawnCalls
}

function findCall(calls, op, directory) {
  return calls.find((c) => c.args.includes(op) && c.args.includes('--directory') && c.args.includes(directory))
}

// Both branches share the same assertion skeleton: did the server inject happen
// (or not), and was the outputDir upload always emitted? Table-drive it so the
// shape stays obvious and a future `ssr: 'hybrid'` row is one line away.
const cases = [
  { ssr: false, expectInject: false },
  { ssr: true, expectInject: true },
]

for (const { ssr, expectInject } of cases) {
  const calls = await runLifecycle({ ssr })
  const dump = JSON.stringify(calls.map((c) => c.args))
  const injectCall = findCall(calls, 'inject', '/build/.output/server')

  if (expectInject) {
    assert.ok(injectCall, `ssr:${ssr}: expected server inject. Got: ${dump}`)
  } else {
    assert.equal(injectCall, undefined, `ssr:${ssr}: expected no server inject. Got: ${dump}`)
  }

  // Upload of the outputDir must always happen so public sourcemaps reach PostHog.
  assert.ok(
    findCall(calls, 'upload', '/build/.output'),
    `ssr:${ssr}: expected sourcemap upload against outputDir. Got: ${dump}`
  )
}

console.log('ok sourcemaps-ssr.test.mjs')
