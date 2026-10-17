import { EventEmitter } from 'node:events'
import { context, trace, ROOT_CONTEXT, type Attributes } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { PostHog } from '@/entrypoints/index.node'
import { PostHogContextSpanProcessor, enrichCurrentSpan } from '@/entrypoints/otel'
import { setupExpressRequestContext } from '@/extensions/express'

describe('OpenTelemetry request context', () => {
  const manager = new AsyncLocalStorageContextManager()
  let client: PostHog
  let exporter: InMemorySpanExporter
  let provider: BasicTracerProvider
  let processor: PostHogContextSpanProcessor

  beforeAll(() => context.setGlobalContextManager(manager.enable()))
  afterAll(() => {
    context.disable()
    manager.disable()
  })

  beforeEach(() => {
    vi.useRealTimers()
    client = new PostHog('test-key', { disableGeoip: true })
    exporter = new InMemorySpanExporter()
    processor = new PostHogContextSpanProcessor(client)
    provider = new BasicTracerProvider({ spanProcessors: [processor, new SimpleSpanProcessor(exporter)] })
  })

  afterEach(async () => {
    await provider.shutdown()
    await client.shutdown()
  })

  function middleware(): (...args: any[]) => void {
    const app = { use: vi.fn() }
    setupExpressRequestContext(client, app)
    return app.use.mock.calls[0][0]
  }

  it.each(['signal', 'request', 'outer-signal'] as const)(
    'expires nested span context on %s completion',
    async (expired) => {
      const response = new EventEmitter()
      const controller = new AbortController()
      const outer = new AbortController()
      const tracer = provider.getTracer('signal-test')
      client.withContext(
        {},
        () => {
          middleware()(
            { headers: { 'x-posthog-session-id': 'request-session', 'x-posthog-distinct-id': 'request-user' } },
            response,
            () => {
              client.withContext(
                { properties: { scope: 'nested' } },
                () => {
                  const before = tracer.startSpan('before')
                  if (expired === 'signal') controller.abort()
                  else if (expired === 'outer-signal') outer.abort()
                  else response.emit('finish')
                  expect(client.getContext()).toBeUndefined()
                  tracer.startSpan('after').end()
                  before.end()
                },
                { signal: controller.signal }
              )
              response.emit('finish')
            }
          )
        },
        { signal: outer.signal }
      )
      await provider.forceFlush()
      expect(exporter.getFinishedSpans().find((span) => span.name === 'before')?.attributes).toEqual({
        sessionId: 'request-session',
        posthogDistinctId: 'request-user',
      })
      expect(exporter.getFinishedSpans().find((span) => span.name === 'after')?.attributes).toEqual({})
    }
  )

  it.each([false, true])('keeps a fresh job independent of the response with own signal=%s', async (withSignal) => {
    const response = new EventEmitter()
    const controller = new AbortController()
    const tracer = provider.getTracer('job-test')
    const data = { distinctId: 'job-user', sessionId: 'job-session' }
    let job: Promise<void> | undefined
    middleware()(
      { headers: { 'x-posthog-session-id': 'request-session', 'x-posthog-distinct-id': 'request-user' } },
      response,
      () => {
        job = client.withContext(
          data,
          async () => {
            await Promise.resolve()
            expect(client.getContext()).toEqual(data)
            tracer.startSpan('job').end()
            if (withSignal) {
              controller.abort()
              expect(client.getContext()).toBeUndefined()
              tracer.startSpan('ended-job').end()
            }
          },
          { fresh: true, signal: withSignal ? controller.signal : undefined }
        )
        response.emit('finish')
        expect(client.getContext()).toBeUndefined()
        tracer.startSpan('ended-request').end()
      }
    )
    await job
    const spans = exporter.getFinishedSpans()
    expect(spans.find((span) => span.name === 'job')?.attributes).toEqual({
      sessionId: 'job-session',
      posthogDistinctId: 'job-user',
    })
    expect(spans.find((span) => span.name === 'ended-request')?.attributes).toEqual({})
    if (withSignal) expect(spans.find((span) => span.name === 'ended-job')?.attributes).toEqual({})
  })

  it.each([
    [{}, { sessionId: 'browser-session', posthogDistinctId: 'browser-user' }],
    [{ sessionId: 'explicit-session' }, { sessionId: 'explicit-session', posthogDistinctId: 'browser-user' }],
    [{ posthogDistinctId: 'app-user' }, { sessionId: 'browser-session', posthogDistinctId: 'app-user' }],
  ])('stamps the existing request span and snapshots children with attributes %j', async (attributes, expected) => {
    const tracer = provider.getTracer('test')
    const requestSpan = tracer.startSpan('request', { attributes })
    const response = new EventEmitter()
    await context.with(
      trace.setSpan(ROOT_CONTEXT, requestSpan),
      () =>
        new Promise<void>((resolve, reject) => {
          middleware()(
            { headers: { 'x-posthog-session-id': 'browser-session', 'x-posthog-distinct-id': 'browser-user' } },
            response,
            () => {
              void (async () => {
                await Promise.resolve()
                const child = tracer.startSpan('child', { attributes })
                client.enterContext({ distinctId: 'later-user', sessionId: 'later-session' })
                response.emit('finish')
                child.end()
                const detached = tracer.startSpan('detached')
                detached.end()
                requestSpan.end()
                resolve()
              })().catch(reject)
            }
          )
        })
    )
    await provider.forceFlush()
    const spans = exporter.getFinishedSpans()
    expect(spans.find((span) => span.name === 'request')?.attributes).toMatchObject(expected)
    expect(spans.find((span) => span.name === 'child')?.attributes).toMatchObject(expected)
    expect(spans.find((span) => span.name === 'detached')?.attributes).toEqual({})
    expect(client.getContext()).toBeUndefined()
  })

  it.each(['finish', 'close'])('isolates concurrent requests and expires scope on %s', async (event) => {
    const tracer = provider.getTracer('test')
    const run = middleware()
    const releases: (() => void)[] = []
    const spans: Attributes[] = []
    await Promise.all(
      ['first', 'second'].map(
        (id) =>
          new Promise<void>((resolve, reject) => {
            const response = new EventEmitter()
            run({ headers: { 'x-posthog-session-id': id } }, response, () => {
              void (async () => {
                await new Promise<void>((release) => releases.push(release))
                const span = tracer.startSpan(id)
                span.end()
                response.emit(event)
                const late = tracer.startSpan('late')
                late.end()
                expect(client.getContext()).toBeUndefined()
                resolve()
              })().catch(reject)
            })
            if (releases.length === 2) releases.reverse().forEach((release) => release())
          })
      )
    )
    await provider.forceFlush()
    exporter.getFinishedSpans().forEach((span) => spans.push(span.attributes))
    expect(spans).toEqual(expect.arrayContaining([{ sessionId: 'first' }, { sessionId: 'second' }, {}]))
  })

  it('preserves application identity and omits invalid or missing header IDs', () => {
    const tracer = provider.getTracer('test')
    client.withContext({ distinctId: 'authenticated-user' }, () => {
      middleware()(
        { headers: { 'x-posthog-distinct-id': 'untrusted-user', 'x-posthog-session-id': ' \n ' } },
        new EventEmitter(),
        () => {
          const span = tracer.startSpan('identity')
          span.end()
        }
      )
    })
    expect(exporter.getFinishedSpans()[0].attributes).toEqual({ posthogDistinctId: 'authenticated-user' })
  })

  it.each(['Express', 'manual'])('adds header session after application identity with %s setup', (setup) => {
    const span = provider.getTracer('test').startSpan('request')
    context.with(trace.setSpan(ROOT_CONTEXT, span), () => {
      client.withContext({ distinctId: 'authenticated-user' }, () => {
        if (setup === 'Express') {
          middleware()(
            { headers: { 'x-posthog-session-id': 'browser-session', 'x-posthog-distinct-id': 'browser-user' } },
            new EventEmitter(),
            () => span.end()
          )
        } else {
          client.withContext({ sessionId: 'browser-session' }, () => {
            enrichCurrentSpan(client)
            span.end()
          })
        }
      })
    })
    expect(exporter.getFinishedSpans()[0].attributes).toEqual({
      sessionId: 'browser-session',
      posthogDistinctId: 'authenticated-user',
    })
  })

  it('does not read context on export or enrich spans after shutdown', async () => {
    const tracer = provider.getTracer('test')
    const span = client.withContext({ sessionId: 'snapshot' }, () => tracer.startSpan('delayed'))
    await processor.shutdown()
    expect(() => enrichCurrentSpan(client)).not.toThrow()
    client.withContext({ sessionId: 'other' }, () => span.end())
    const later = client.withContext({ sessionId: 'other' }, () => tracer.startSpan('later'))
    later.end()
    expect(exporter.getFinishedSpans().map((span) => span.attributes)).toEqual([{ sessionId: 'snapshot' }, {}])
  })

  it('keeps explicit attributes when the SDK attribute limit is full', async () => {
    await provider.shutdown()
    exporter = new InMemorySpanExporter()
    processor = new PostHogContextSpanProcessor(client)
    provider = new BasicTracerProvider({
      spanLimits: { attributeCountLimit: 1 },
      spanProcessors: [processor, new SimpleSpanProcessor(exporter)],
    })
    client.withContext({ sessionId: 'browser-session', distinctId: 'browser-user' }, () => {
      const span = provider.getTracer('test').startSpan('full', { attributes: { posthogDistinctId: 'explicit-user' } })
      span.end()
    })
    expect(exporter.getFinishedSpans()[0].attributes).toEqual({ posthogDistinctId: 'explicit-user' })
  })

  it.each(['withContext', 'enterContext'])('keeps absent IDs stable through %s', (setup) => {
    const tracer = provider.getTracer('test')
    client.withContext({ distinctId: 'original-user' }, () => {
      const span = tracer.startSpan('snapshot')
      context.with(trace.setSpan(context.active(), span), () => {
        if (setup === 'withContext') {
          client.withContext({ sessionId: 'later-session' }, () => span.end())
        } else {
          client.enterContext({ sessionId: 'later-session' })
          span.end()
        }
      })
    })
    expect(exporter.getFinishedSpans()[0].attributes).toEqual({ posthogDistinctId: 'original-user' })
  })

  it.each([
    [{ sessionId: 'job' }, { sessionId: 'job' }],
    [{ distinctId: 'job-user' }, { posthogDistinctId: 'job-user' }],
  ])('clears a thrown request scope and accepts explicit context %j after expiry', async (data, expected) => {
    const error = new Error('handler failed')
    let detached: Promise<void> | undefined
    let release: () => void = () => undefined
    expect(() =>
      middleware()(
        { headers: { 'x-posthog-session-id': 'request', 'x-posthog-distinct-id': 'request-user' } },
        new EventEmitter(),
        () => {
          detached = (async () => {
            await new Promise<void>((resolve) => {
              release = resolve
            })
            expect(client.getContext()).toBeUndefined()
            client.withContext(
              data,
              () => {
                provider.getTracer('test').startSpan('job').end()
              },
              { fresh: true }
            )
          })()
          throw error
        }
      )
    ).toThrow(error)
    release()
    await detached
    expect(exporter.getFinishedSpans()[0].attributes).toEqual(expected)
  })

  it('keeps clients and processor shutdown separate', async () => {
    const other = new PostHog('other-test-key')
    const duplicate = new PostHogContextSpanProcessor(client)
    const separate = new PostHogContextSpanProcessor(other)
    try {
      await duplicate.shutdown()
      other.withContext({ sessionId: 'other' }, () => {
        client.withContext({ sessionId: 'client' }, () => {
          provider.getTracer('test').startSpan('own-client').end()
        })
      })
      expect(exporter.getFinishedSpans()[0].attributes).toEqual({ sessionId: 'client' })
    } finally {
      await separate.shutdown()
      await other.shutdown()
    }
  })

  it('ignores API-only spans and context lookup failures', () => {
    const apiSpan = trace.wrapSpanContext({ traceId: '1'.repeat(32), spanId: '2'.repeat(16), traceFlags: 0 })
    expect(() =>
      context.with(trace.setSpan(ROOT_CONTEXT, apiSpan), () =>
        client.withContext({ sessionId: 'test' }, () => undefined)
      )
    ).not.toThrow()
    vi.spyOn(client, 'getContext').mockImplementation(() => {
      throw new Error('lookup failed')
    })
    expect(() => provider.getTracer('test').startSpan('safe').end()).not.toThrow()
  })
})
