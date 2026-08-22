import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/runtime/nitro-plugin.ts', import.meta.url), 'utf8')
assert.doesNotMatch(source, /from ['"]nitro/)

const executableSource = source
  .replace(/^import .*$/gm, '')
  .replace(/^type [\s\S]+?^export function /m, 'return function ')
  .replace(': NitroBindings', '')
  .replace('): void {', ') {')
  .replace(' as RuntimeConfig', '')
  .replace(': JsonType', '')

function loadSetup({ PostHog, uuidv7 }) {
  return new Function('PostHog', 'uuidv7', executableSource)(PostHog, uuidv7)
}

const calls = []
class PostHog {
  constructor(...args) {
    calls.push(['constructor', ...args])
  }

  debug(...args) {
    calls.push(['debug', ...args])
  }

  captureException(...args) {
    calls.push(['captureException', ...args])
  }

  async flush() {
    calls.push(['flush'])
  }

  async shutdown() {
    calls.push(['shutdown'])
  }
}

const handlers = {}
const setupPostHogNitroPlugin = loadSetup({ PostHog, uuidv7: () => 'event-id' })
setupPostHogNitroPlugin({
  useRuntimeConfig: () => ({
    public: {
      posthog: {
        publicKey: 'phc_test',
        host: 'https://us.i.posthog.com',
        debug: true,
      },
    },
    posthogServerConfig: {
      enableExceptionAutocapture: true,
      flushAt: 1,
    },
  }),
  onError: (handler) => {
    handlers.error = handler
  },
  onClose: (handler) => {
    handlers.close = handler
  },
})

assert.deepEqual(calls.slice(0, 2), [
  ['constructor', 'phc_test', { host: 'https://us.i.posthog.com', enableExceptionAutocapture: true, flushAt: 1 }],
  ['debug', true],
])
assert.equal(typeof handlers.error, 'function')
assert.equal(typeof handlers.close, 'function')

const error = new Error('server failure')
await handlers.error(error, { path: '/api/test', method: 'POST' })
assert.deepEqual(calls[2], [
  'captureException',
  error,
  'event-id',
  { $process_person_profile: false, path: '/api/test', method: 'POST' },
])
assert.deepEqual(calls[3], ['flush'])

const backgroundError = new Error('background failure')
await handlers.error(backgroundError)
assert.deepEqual(calls[4], [
  'captureException',
  backgroundError,
  'event-id',
  { $process_person_profile: false },
])
assert.deepEqual(calls[5], ['flush'])

await handlers.close()
assert.deepEqual(calls[6], ['shutdown'])

function loadAdapter(filename, defineName) {
  const adapterSource = readFileSync(new URL(`../src/runtime/${filename}`, import.meta.url), 'utf8')
  const executableAdapter = adapterSource
    .replace(/^import .*$/gm, '')
    .replace(': NitroAppPlugin', '')
    .replace(`export default ${defineName}(`, `return ${defineName}(`)
    .replace(/^export default (\w+)$/m, 'return $1')
  let bindings
  const plugin = new Function(defineName, 'useRuntimeConfig', 'setupPostHogNitroPlugin', executableAdapter)(
    value => value,
    () => ({}),
    (value) => {
      bindings = value
    },
  )
  const adapterHandlers = {}
  plugin({
    hooks: {
      hook(name, handler) {
        adapterHandlers[name] = handler
      },
    },
  })
  return { adapterSource, bindings, adapterHandlers }
}

const nitro2 = loadAdapter('nitro-plugin-v2.ts', 'defineNitroPlugin')
assert.match(nitro2.adapterSource, /from 'nitropack\/runtime'/)
assert.doesNotMatch(nitro2.adapterSource, /from '#imports'/)
let nitro2Request
const nitro2Promise = Promise.resolve()
nitro2.bindings.onError((_error, request) => {
  nitro2Request = request
  return nitro2Promise
})
assert.equal(nitro2.adapterHandlers.error(error, { event: { path: '/v2', method: 'GET' } }), nitro2Promise)
assert.deepEqual(nitro2Request, { path: '/v2', method: 'GET' })

// The legacy adapter serves Nuxt < 3.12, where nitropack can resolve below 2.9.5 and the
// bare 'nitropack/runtime' subpath does not exist (ERR_PACKAGE_PATH_NOT_EXPORTED at server
// startup); it must stay on the `#imports` virtual module, which every Nitro 2 provides.
const nitro2Legacy = loadAdapter('nitro-plugin-v2-legacy.ts', 'defineNitroPlugin')
assert.doesNotMatch(nitro2Legacy.adapterSource, /from 'nitropack\/runtime/)
assert.match(nitro2Legacy.adapterSource, /from '#imports'/)
let legacyRequest
const legacyPromise = Promise.resolve()
nitro2Legacy.bindings.onError((_error, request) => {
  legacyRequest = request
  return legacyPromise
})
assert.equal(nitro2Legacy.adapterHandlers.error(error, { event: { path: '/legacy', method: 'GET' } }), legacyPromise)
assert.deepEqual(legacyRequest, { path: '/legacy', method: 'GET' })

// module.ts must route old Nuxt to the legacy adapter.
const moduleSource = readFileSync(new URL('../src/module.ts', import.meta.url), 'utf8')
assert.match(moduleSource, /nitro-plugin-v2-legacy/)

const nitro3 = loadAdapter('nitro-plugin-v3.ts', 'definePlugin')
assert.match(nitro3.adapterSource, /from 'nitro'/)
assert.match(nitro3.adapterSource, /from 'nitro\/runtime-config'/)
let nitro3Request
const nitro3Promise = Promise.resolve()
const waitUntil = () => {}
nitro3.bindings.onError((_error, request) => {
  nitro3Request = request
  return nitro3Promise
})
assert.equal(
  nitro3.adapterHandlers.error(error, {
    event: { req: { url: 'https://example.com/v3?query=ignored', method: 'POST', waitUntil } },
  }),
  nitro3Promise,
)
assert.deepEqual(nitro3Request, { path: '/v3', method: 'POST' })
