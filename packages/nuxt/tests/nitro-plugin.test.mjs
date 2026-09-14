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
assert.deepEqual(calls[4], ['captureException', backgroundError, 'event-id', { $process_person_profile: false }])
assert.deepEqual(calls[5], ['flush'])

await handlers.close()
assert.deepEqual(calls[6], ['shutdown'])

function loadAdapter(filename, defineName) {
  const adapterSource = readFileSync(new URL(`../src/runtime/${filename}`, import.meta.url), 'utf8')
  const executableAdapter = adapterSource
    .replace(/^import .*$/gm, '')
    .replace(`export default ${defineName}(`, `return ${defineName}(`)
  let bindings
  const plugin = new Function(defineName, 'useRuntimeConfig', 'setupPostHogNitroPlugin', executableAdapter)(
    (value) => value,
    () => ({}),
    (value) => {
      bindings = value
    }
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
  nitro3Promise
)

assert.deepEqual(nitro3Request, { path: 'https://example.com/v3?query=ignored', method: 'POST' })

for (const [adapter, promise, getRequest] of [
  [nitro2, nitro2Promise, () => nitro2Request],
  [nitro3, nitro3Promise, () => nitro3Request],
]) {
  assert.equal(adapter.adapterHandlers.error(backgroundError, {}), promise)
  assert.equal(getRequest(), undefined)
}

// Fragments are simulated here; browsers do not normally send them in HTTP requests.
for (const [filename, defineName, makeEvent] of [
  ['nitro-plugin-v2.ts', 'defineNitroPlugin', (path) => ({ path, method: 'POST' })],
  ['nitro-plugin-v3.ts', 'definePlugin', (url) => ({ req: { url, method: 'POST' } })],
]) {
  for (const disableCaptureUrlHashes of [false, true, undefined]) {
    const adapter = loadAdapter(filename, defineName)
    const serverConfig = {
      enableExceptionAutocapture: true,
      ...(disableCaptureUrlHashes === undefined ? {} : { disable_capture_url_hashes: disableCaptureUrlHashes }),
    }
    setupPostHogNitroPlugin({
      ...adapter.bindings,
      useRuntimeConfig: () => ({
        public: {
          posthog: { publicKey: 'phc_test', host: 'https://us.i.posthog.com' },
          posthogClientConfig: { disable_capture_url_hashes: !disableCaptureUrlHashes, defaults: '2026-06-25' },
        },
        posthogServerConfig: serverConfig,
      }),
    })
    assert.deepEqual(calls.at(-1), ['constructor', 'phc_test', { host: 'https://us.i.posthog.com', ...serverConfig }])

    // Nitro 2 supports relative and absolute-form targets. Both adapters share safe parsing.
    for (const [path, pathname, hash = ''] of [
      ['/account?token=synthetic-query#synthetic-fragment', '/account', '#synthetic-fragment'],
      ['/account#synthetic-fragment?token=fragment-value', '/account', '#synthetic-fragment?token=fragment-value'],
      ['https://example.invalid/account?token=synthetic-query#synthetic-fragment', '/account', '#synthetic-fragment'],
      ['https://example.invalid/account#fragment?fragment-value', '/account', '#fragment?fragment-value'],
      ['account?token=synthetic-query#fragment', '/account', '#fragment'],
      ['/a/../b/%2e%2e/c%2Fd//?token=synthetic-query#fragment', '/c%2Fd//', '#fragment'],
      ['//account/settings?token=synthetic-query#fragment', '//account/settings', '#fragment'],
      [
        '/account%3Ftoken%23fragment?token=synthetic-query#encoded%3F%23',
        '/account%3Ftoken%23fragment',
        '#encoded%3F%23',
      ],
      ['/synthetic-path-credential', '/synthetic-path-credential'],
      ['/account?token=synthetic-query', '/account'],
      ['/account#fragment', '/account', '#fragment'],
      ['http://[invalid/account?token=synthetic-query#fragment', undefined],
      ['', undefined],
      [undefined, undefined],
    ]) {
      const expected = pathname === undefined ? undefined : pathname + (disableCaptureUrlHashes ? '' : hash)
      const before = calls.length
      const result = adapter.adapterHandlers.error(error, { event: makeEvent(path) })
      assert.equal(typeof result?.then, 'function')
      await result
      assert.deepEqual(
        calls.slice(before),
        [
          [
            'captureException',
            error,
            'event-id',
            {
              $process_person_profile: false,
              ...(expected === undefined ? {} : { path: expected }),
              method: 'POST',
            },
          ],
          ['flush'],
        ],
        `${filename}, disable_capture_url_hashes=${disableCaptureUrlHashes}, target=${path}`
      )
    }
    const before = calls.length
    await adapter.adapterHandlers.error(backgroundError, {})
    await adapter.adapterHandlers.close()
    assert.deepEqual(calls.slice(before), [
      ['captureException', backgroundError, 'event-id', { $process_person_profile: false }],
      ['flush'],
      ['shutdown'],
    ])
  }
}
