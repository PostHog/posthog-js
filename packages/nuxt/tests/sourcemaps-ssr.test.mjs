// Regression test for PostHog/posthog-js#3005 — Nuxt module used to fail
// sourcemap upload when `ssr: false` because the `close` hook injected against
// nitro's reported `serverDir` even when no server bundle was produced
// (e.g. `nuxt generate`), causing the CLI to exit 1.
// The branch now follows the directory on disk, because a `ssr: false` SPA still
// gets a Nitro server bundle: its chunks must be injected before they are uploaded,
// and only injected directories may be uploaded.
// Also covers PostHog/posthog-js#4275: public sourcemaps must be uploaded and
// deleted before Nitro generates its public-asset manifest.
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
  .replace(/\(sourcemapsConfig: SourcemapsConfig\)/g, '(sourcemapsConfig)')
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

function loadModule({ failPublicUpload = false, nuxtVersion = '4.1.2', existingDirs = [] } = {}) {
  const spawnCalls = []
  const pluginCalls = []
  const serverPluginCalls = []
  const stubs = {
    defineNuxtModule: (config) => config,
    addPlugin: (plugin) => pluginCalls.push(plugin),
    addServerPlugin: (plugin) => serverPluginCalls.push(plugin),
    addImportsDir: () => {},
    createResolver: () => ({ resolve: (p) => p }),
    getNuxtVersion: () => nuxtVersion,
    resolveBinaryPath: () => '/fake/posthog-cli',
    spawnLocal: async (bin, args) => {
      spawnCalls.push({ bin, args: [...args] })
      if (failPublicUpload && args.includes('upload') && args.includes('/build/.output/public')) {
        throw new Error('public upload failed')
      }
      return { code: 0 }
    },
    existsSync: (path) => existingDirs.includes(path),
    fileURLToPath: (u) => u,
    dirname: (p) => p,
    console: { error: () => {} },
  }
  const factory = new Function(...Object.keys(stubs), executableSource)
  const mod = factory(...Object.values(stubs))
  return { mod, spawnCalls, pluginCalls, serverPluginCalls }
}

async function runRegistration({ nuxtVersion, compatibilityVersion }) {
  const { mod, pluginCalls, serverPluginCalls } = loadModule({ nuxtVersion })
  const nuxt = {
    options: {
      dev: true,
      future: { compatibilityVersion },
      runtimeConfig: { public: {} },
    },
    hook() {},
  }

  await mod.setup(
    {
      host: 'https://us.i.posthog.com',
      publicKey: 'phc_test',
      clientConfig: {},
      serverConfig: {},
    },
    nuxt
  )

  return { pluginCalls, serverPluginCalls }
}

for (const { nuxtVersion, compatibilityVersion, expectedServerPlugin } of [
  { nuxtVersion: '3.7.0', expectedServerPlugin: './runtime/nitro-plugin-v2' },
  { nuxtVersion: '4.1.2', expectedServerPlugin: './runtime/nitro-plugin-v2' },
  { nuxtVersion: '4.1.2', compatibilityVersion: 5, expectedServerPlugin: './runtime/nitro-plugin-v2' },
  { nuxtVersion: '5.0.0-0', expectedServerPlugin: './runtime/nitro-plugin-v3' },
  { nuxtVersion: '5.0.0-29762631.396a4ae3', expectedServerPlugin: './runtime/nitro-plugin-v3' },
]) {
  const { pluginCalls, serverPluginCalls } = await runRegistration({ nuxtVersion, compatibilityVersion })
  assert.deepEqual(pluginCalls, [{ src: './runtime/vue-plugin', mode: 'client' }])
  assert.deepEqual(serverPluginCalls, [expectedServerPlugin])
}

async function runLifecycle({
  ssr,
  deleteAfterUpload,
  failPublicUpload = false,
  serverBundleOnDisk = true,
  sourcemaps = {},
}) {
  const { mod, spawnCalls } = loadModule({
    failPublicUpload,
    existingDirs: serverBundleOnDisk ? ['/build/.output/server'] : [],
  })
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
        deleteAfterUpload,
        ...sourcemaps,
      },
    },
    nuxt
  )

  // Nitro reports the same output dirs for every mode. Whether a server bundle exists
  // is decided by `serverBundleOnDisk`, the same way the module reads it from disk.
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

// A Nitro server bundle is injected and uploaded whenever it is on disk, in SSR mode
// and in SPA (`ssr: false`) mode alike. `nuxt generate` writes no server bundle, so
// nothing there is injected or uploaded.
const cases = [
  { name: 'spa with server bundle', ssr: false, serverBundleOnDisk: true, expectServer: true },
  { name: 'ssr', ssr: true, serverBundleOnDisk: true, expectServer: true },
  { name: 'static generate', ssr: false, serverBundleOnDisk: false, expectServer: false },
]

for (const { name, ssr, serverBundleOnDisk, expectServer } of cases) {
  const calls = await runLifecycle({ ssr, serverBundleOnDisk })
  const dump = JSON.stringify(calls.map((c) => c.args))
  const injectCall = findCall(calls, 'inject', '/build/.output/server')
  const serverUploadCall = findCall(calls, 'upload', '/build/.output/server')

  if (expectServer) {
    assert.ok(injectCall, `${name}: expected server inject. Got: ${dump}`)
    assert.ok(serverUploadCall, `${name}: expected server upload. Got: ${dump}`)
    assert.ok(
      calls.indexOf(injectCall) < calls.indexOf(serverUploadCall),
      `${name}: expected the server chunks to be injected before they are uploaded. Got: ${dump}`
    )
  } else {
    assert.equal(injectCall, undefined, `${name}: expected no server inject. Got: ${dump}`)
    assert.equal(serverUploadCall, undefined, `${name}: expected no server upload. Got: ${dump}`)
  }

  const publicUploadCall = findCall(calls, 'upload', '/build/.output/public')
  assert.ok(publicUploadCall, `${name}: expected early public sourcemap upload. Got: ${dump}`)
  assert.ok(publicUploadCall.args.includes('--delete-after'), `${name}: expected public sourcemap deletion`)
  assert.equal(
    calls.filter((c) => c.args.includes('upload') && c.args.includes('/build/.output/public')).length,
    1,
    `${name}: expected the public directory to be uploaded once. Got: ${dump}`
  )
  assert.equal(
    findCall(calls, 'upload', '/build/.output'),
    undefined,
    `${name}: expected no upload of the whole output directory, which holds uninjected chunks. Got: ${dump}`
  )
}

// Every command must carry the configured release, or the CLI derives a second release
// from the checkout directory name.
const releaseCalls = await runLifecycle({
  ssr: true,
  sourcemaps: { releaseName: 'my-app', releaseVersion: '1.2.3', build: 42 },
})
for (const call of releaseCalls) {
  const dump = JSON.stringify(call.args)
  assert.deepEqual(
    [
      call.args[call.args.indexOf('--release-name') + 1],
      call.args[call.args.indexOf('--release-version') + 1],
      call.args[call.args.indexOf('--build') + 1],
    ],
    ['my-app', '1.2.3', '42'],
    `expected the configured release on every CLI call. Got: ${dump}`
  )
}

const retainedMapCalls = await runLifecycle({ ssr: true, deleteAfterUpload: false })
const retainedMapDump = JSON.stringify(retainedMapCalls.map((c) => c.args))
const retainedPublicUpload = findCall(retainedMapCalls, 'upload', '/build/.output/public')
assert.ok(retainedPublicUpload, `deleteAfterUpload:false: expected a public upload. Got: ${retainedMapDump}`)
assert.ok(
  !retainedPublicUpload.args.includes('--delete-after'),
  `deleteAfterUpload:false: expected sourcemaps to be retained. Got: ${retainedMapDump}`
)

const failedPublicUploadCalls = await runLifecycle({ ssr: true, failPublicUpload: true })
const failedPublicUploadDump = JSON.stringify(failedPublicUploadCalls.map((c) => c.args))
const publicUploads = failedPublicUploadCalls.filter(
  (c) => c.args.includes('upload') && c.args.includes('/build/.output/public')
)
assert.equal(
  publicUploads.length,
  2,
  `failed public upload: expected a retry in the close hook. Got: ${failedPublicUploadDump}`
)
assert.ok(
  !publicUploads[1].args.includes('--delete-after'),
  `failed public upload: expected the retry to retain manifest-listed maps. Got: ${failedPublicUploadDump}`
)

console.log('ok sourcemaps-ssr.test.mjs')
