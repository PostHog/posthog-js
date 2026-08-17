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
// Bare 'nitropack/runtime' only exists in nitropack >= 2.9.5, so a value import breaks
// the declared Nuxt >= 3.7 floor at server startup (ERR_PACKAGE_PATH_NOT_EXPORTED);
// the Nitro 2 adapter must use the version-agnostic `#imports` virtual module instead.
assert.doesNotMatch(nitro2.adapterSource, /^import (?!type ).*'nitropack\/runtime'/m)
assert.match(nitro2.adapterSource, /from '#imports'/)
let nitro2Request
const nitro2Promise = Promise.resolve()
nitro2.bindings.onError((_error, request) => {
  nitro2Request = request
  return nitro2Promise
})
assert.equal(nitro2.adapterHandlers.error(error, { event: { path: '/v2', method: 'GET' } }), nitro2Promise)
assert.deepEqual(nitro2Request, { path: '/v2', method: 'GET' })

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
