import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import ts from 'typescript'
import { PostHog } from 'posthog-node'
import { PostHogContextSpanProcessor, enrichCurrentSpan } from 'posthog-node/otel'
import { context } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'

const require = createRequire(import.meta.url)
const errors = []
class CapturingPostHog extends PostHog {
  captureException(error, distinctId, properties) {
    errors.push({ error, distinctId, properties, context: this.getContext() })
  }
}

function loadRuntime(name, dependencies) {
  const source = readFileSync(new URL(`../src/runtime/${name}.ts`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  new Function('exports', 'require', compiled)(exports, (name) => dependencies[name] ?? require(name))
  return exports
}

const clientState = loadRuntime('server-client', {})
const server = loadRuntime('server', { './server-client': clientState })
assert.equal(server.getPostHogServerClient(), undefined)
const { setupPostHogNitroPlugin } = loadRuntime('nitro-plugin', {
  'posthog-node': { PostHog: CapturingPostHog, enrichCurrentSpan },
  '@posthog/core/vendor/uuidv7': { uuidv7: () => 'anonymous-id' },
  './server-client': clientState,
})

for (const requestContext of [undefined, false, true]) {
  let wrapper
  let onError
  let close
  setupPostHogNitroPlugin({
    useRuntimeConfig: () => ({
      public: { posthog: { publicKey: 'phc_test', host: 'https://example.com' } },
      posthogServerConfig: { before_send: () => null, enableExceptionAutocapture: true, requestContext },
    }),
    wrapRequest: (handler) => {
      wrapper = handler
    },
    onError: (handler) => {
      onError = handler
    },
    onClose: (handler) => {
      close = handler
    },
  })
  const client = server.getPostHogServerClient()
  assert.ok(client instanceof PostHog)
  assert.equal(client.options.requestContext, undefined)
  assert.equal(typeof wrapper, requestContext ? 'function' : 'undefined')
  await onError(new Error('background'))
  assert.equal(errors.at(-1).distinctId, 'anonymous-id')
  if (wrapper) {
    const manager = new AsyncLocalStorageContextManager().enable()
    context.setGlobalContextManager(manager)
    const provider = new BasicTracerProvider({ spanProcessors: [new PostHogContextSpanProcessor(client)] })
    try {
      for (const explicit of [{}, { posthogDistinctId: 'explicit-person' }]) {
        await client.withContext({ distinctId: 'application-person' }, () =>
          provider.getTracer('incoming-context').startActiveSpan('incoming', { attributes: explicit }, async (span) => {
            try {
              await wrapper({ source: {}, headers: { 'x-posthog-session-id': 'request-session' } }, () => {
                assert.equal(client.getContext().distinctId, 'application-person')
              })
              assert.equal(span.attributes.posthogDistinctId, explicit.posthogDistinctId ?? 'application-person')
              assert.equal(span.attributes.sessionId, 'request-session')
            } finally {
              span.end()
            }
          })
        )
      }
    } finally {
      await provider.shutdown()
      context.disable()
      manager.disable()
    }

    for (const headers of [undefined, {}, { 'x-posthog-distinct-id': ' ', 'x-posthog-session-id': '\t' }]) {
      const source = {}
      await wrapper({ source, headers }, async () => {
        assert.equal(client.getContext()?.distinctId, undefined)
        assert.equal(client.getContext()?.sessionId, undefined)
      })
      await onError(new Error('unlinked'), { source })
      assert.equal(errors.at(-1).distinctId, 'anonymous-id')
      assert.equal(errors.at(-1).properties.$session_id, undefined)
    }
    for (const [value, expected] of [
      [[' ', 'person'], 'person'],
      [' \u0000person\u007F ', 'person'],
      ['p'.repeat(1001), 'p'.repeat(1000)],
    ]) {
      await wrapper({ source: {}, headers: { 'x-posthog-distinct-id': value } }, async () => {
        assert.equal(client.getContext()?.distinctId, expected)
      })
    }
    await client.withContext({ distinctId: 'authenticated' }, () =>
      wrapper(
        {
          source: {},
          headers: { 'x-posthog-distinct-id': 'browser-person' },
        },
        async () => {
          assert.equal(client.getContext()?.distinctId, 'authenticated')
        }
      )
    )
    let release
    const after = new Promise((resolve) => {
      release = resolve
    })
    const detached = []
    await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const source = {}
        const id = 'person-' + index
        const headers = { 'x-posthog-distinct-id': id, 'x-posthog-session-id': id + '-session' }
        const error = new Error('request failed')
        try {
          await wrapper({ source, headers }, async () => {
            await Promise.resolve()
            assert.equal(client.getContext()?.distinctId, id)
            assert.equal(client.getContext()?.sessionId, id + '-session')
            detached.push(after.then(() => assert.equal(client.getContext(), undefined)))
            throw error
          })
        } catch (caught) {
          assert.equal(caught, error)
        }
        await onError(error, { source })
        const captured = errors.find((value) => value.error === error)
        assert.equal(captured.distinctId, id)
        assert.equal(captured.properties.$session_id, id + '-session')
        assert.equal(captured.context.distinctId, id)
      })
    )
    release()
    await Promise.all(detached)
  }
  await close()
  assert.equal(server.getPostHogServerClient(), undefined)
}

console.log(
  'Nuxt server context: default/disabled, blank headers, 12 concurrent errors, snapshots, expiry, and client reuse passed'
)

for (const version of [2, 3]) {
  const config = {
    public: { posthog: { publicKey: 'phc_test', host: 'https://example.com' } },
    posthogServerConfig: { before_send: () => null, enableExceptionAutocapture: true, requestContext: true },
  }
  const hooks = {}
  const h3 = createRequire(import.meta.resolve(version === 2 ? 'nitropack/runtime' : 'nitro'))('h3')
  let nitro
  let request
  let listener
  let httpServer
  const onError = async (error, event) => {
    await hooks.error(error, { event })
    if (version === 3) return Response.json({ error: 'request failed' }, { status: 500 })
  }
  const route = async (event) => {
    const id =
      version === 2 ? event.node.req.headers['x-posthog-distinct-id'] : event.req.headers.get('x-posthog-distinct-id')
    await Promise.resolve()
    tracer.startSpan('child:' + id).end()
    const observed = client.getContext()
    detached.push(
      afterResponse.then(() => {
        assert.equal(client.getContext(), undefined)
        tracer.startSpan('after:' + id).end()
      })
    )
    assert.equal(observed?.distinctId, id)
    if (id.endsWith('1')) throw h3.createError({ statusCode: 500, message: 'request failed' })
    return { person: observed.distinctId, session: observed.sessionId }
  }
  const app = version === 2 ? h3.createApp({ onError }) : new h3.H3({ onError })
  if (version === 2) {
    app.use(h3.eventHandler(route))
    nitro = { h3App: app }
    listener = h3.toNodeListener(app)
  } else {
    app.get('/', route)
    nitro = { fetch: (request) => app.fetch(request) }
  }
  nitro.hooks = {
    hook: (name, handler) => {
      hooks[name] = handler
    },
  }
  const adapter = loadRuntime('nitro-plugin-v' + version, {
    [version === 2 ? 'nitropack/runtime' : 'nitro']: {
      defineNitroPlugin: (plugin) => plugin,
      definePlugin: (plugin) => plugin,
      useRuntimeConfig: () => config,
    },
    'nitro/runtime-config': { useRuntimeConfig: () => config },
    './nitro-plugin': { setupPostHogNitroPlugin },
  }).default
  adapter(nitro)
  const client = server.getPostHogServerClient()
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    spanProcessors: [new PostHogContextSpanProcessor(client), new SimpleSpanProcessor(exporter)],
  })
  const tracer = provider.getTracer('nuxt-server-context')
  const manager = new AsyncLocalStorageContextManager().enable()
  context.setGlobalContextManager(manager)
  const detached = []
  let release
  const afterResponse = new Promise((resolve) => {
    release = resolve
  })
  if (version === 2) {
    httpServer = createServer((req, res) =>
      tracer.startActiveSpan('request:' + req.headers['x-posthog-distinct-id'], async (span) => {
        try {
          await listener(req, res)
        } finally {
          span.end()
        }
      })
    )
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    request = async (id) => {
      const response = await fetch('http://127.0.0.1:' + httpServer.address().port, {
        headers: { 'x-posthog-distinct-id': id, 'x-posthog-session-id': id + '-session' },
      })
      return { status: response.status, body: await response.json() }
    }
  } else {
    request = (id) =>
      tracer.startActiveSpan('request:' + id, async (span) => {
        try {
          const response = await nitro.fetch(
            new Request('http://example.com/', {
              headers: { 'x-posthog-distinct-id': id, 'x-posthog-session-id': id + '-session' },
            })
          )
          return { status: response.status, body: await response.json() }
        } finally {
          span.end()
        }
      })
  }
  try {
    const ids = Array.from({ length: 12 }, (_, index) => 'request-' + index)
    const values = await Promise.all(ids.map((id) => request(id)))
    values.forEach((value, index) => {
      assert.equal(value.status, ids[index].endsWith('1') ? 500 : 200)
      if (value.status === 200) assert.deepEqual(value.body, { person: ids[index], session: ids[index] + '-session' })
    })
    release()
    await Promise.all(detached)
    for (const span of exporter.getFinishedSpans()) {
      const [kind, id] = span.name.split(':')
      assert.equal(span.attributes.posthogDistinctId, kind === 'after' ? undefined : id)
      assert.equal(span.attributes.sessionId, kind === 'after' ? undefined : id + '-session')
    }
    assert.equal(exporter.getFinishedSpans().length, 36)
    for (const id of ids.filter((id) => id.endsWith('1'))) {
      assert.ok(errors.some((error) => error.distinctId === id && error.properties.$session_id === id + '-session'))
    }
    console.log(
      'Nuxt Nitro' + version + ': real H3 handlers, 12 concurrent requests, 36 spans, errors and expiry passed'
    )
  } finally {
    if (httpServer) {
      httpServer.closeAllConnections()
      await new Promise((resolve) => httpServer.close(resolve))
    }
    await hooks.close()
    await provider.shutdown()
    manager.disable()
    context.disable()
  }
}
