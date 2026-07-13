import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/runtime/vue-plugin.ts', import.meta.url), 'utf8')

const executableSource = source
  .replace(/^import .*$/gm, '')
  .replace('export default defineNuxtPlugin({', 'return defineNuxtPlugin({')
  .replace(/ as (PostHogCommon|PostHogClientConfig)/g, '')
  .replace('function autocaptureEnabled(config: PostHogClientConfig): boolean', 'function autocaptureEnabled(config)')

function loadPlugin({ posthog, useRuntimeConfig }) {
  return new Function('defineNuxtPlugin', 'useRuntimeConfig', 'posthog', 'window', executableSource)(
    (plugin) => plugin,
    useRuntimeConfig,
    posthog,
    {}
  )
}

function testVueErrorHandlerCapturesInfoString() {
  const captureExceptionCalls = []
  const posthog = {
    __loaded: false,
    init() {},
    debug() {},
    captureException(...args) {
      captureExceptionCalls.push(args)
    },
  }
  const useRuntimeConfig = () => ({
    public: {
      posthog: {
        publicKey: 'test-token',
        host: 'https://us.i.posthog.com',
      },
      posthogClientConfig: {
        capture_exceptions: true,
      },
    },
  })
  const hookCalls = []
  const plugin = loadPlugin({ posthog, useRuntimeConfig })

  plugin.setup({
    hook(name, handler) {
      hookCalls.push([name, handler])
    },
  })

  const vueErrorHandler = hookCalls.find(([name]) => name === 'vue:error')?.[1]
  assert.equal(typeof vueErrorHandler, 'function')

  const error = new Error('test Vue render error')
  const target = { component: 'instance' }

  vueErrorHandler(error, target, 'setup function')

  assert.deepEqual(captureExceptionCalls, [[error, { info: 'setup function' }]])
  assert.notEqual(captureExceptionCalls[0][1].info, target)
}

testVueErrorHandlerCapturesInfoString()
