import { platform, release } from 'node:os'
import { PostHog } from '@/entrypoints/index.node'
import type { OtlpSpan, OtlpTracesPayload } from '@posthog/types'
import { waitForPromises } from './utils'
import { isGzipSupported, osResourceAttributes } from '@posthog/core'

vi.mock('../version', () => ({ version: '1.2.3' }))

const mockedFetch = vi.spyOn(globalThis, 'fetch').mockImplementation()

describe('PostHog traces', () => {
  let posthog: PostHog

  const createClient = (options: Record<string, any> = {}): PostHog =>
    new PostHog('phc_test_key', {
      host: 'http://example.com',
      flushAt: 1,
      fetchRetryCount: 0,
      disableCompression: true,
      traces: { serviceName: 'checkout-api' },
      ...options,
    })

  const traceRequests = (): [string, any][] =>
    mockedFetch.mock.calls.filter((call) => (call[0] as string).includes('/i/v1/traces')) as [string, any][]

  const sentPayloads = (): OtlpTracesPayload[] =>
    traceRequests().map(([, init]) => JSON.parse(init.body as string) as OtlpTracesPayload)

  const sentSpans = (): OtlpSpan[] => sentPayloads().flatMap((p) => p.resourceSpans[0].scopeSpans[0].spans)

  const attributeOf = (span: OtlpSpan, key: string): any => span.attributes?.find((a) => a.key === key)?.value

  // Traces run their own flush cycle; this advances it without calling flush().
  const DEFAULT_TRACES_FLUSH_INTERVAL_MS = 5000
  const flushTraces = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(DEFAULT_TRACES_FLUSH_INTERVAL_MS)
    await waitForPromises()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockedFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('{}'),
      json: () => Promise.resolve({}),
    } as any)
    posthog = createClient()
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  describe('configuration', () => {
    it('is off until the traces option is supplied', async () => {
      const untraced = createClient({ traces: undefined })
      const span = untraced.startSpan('checkout')
      span.end()
      await untraced.shutdown()

      expect(span.traceparent()).toBeNull()
      expect(traceRequests()).toHaveLength(0)
    })

    it('still runs a withSpan callback when tracing is off', async () => {
      const untraced = createClient({ traces: undefined })
      const fn = vi.fn(() => 'value')

      expect(untraced.withSpan('job', fn)).toBe('value')
      expect(fn).toHaveBeenCalledTimes(1)
      expect(untraced.getActiveSpan()).toBeNull()
      await untraced.shutdown()
    })

    it('passes an inbound trace through a service that has tracing off', async () => {
      const untraced = createClient({ traces: undefined })
      const inbound = `00-${'4bf92f3577b34da6a3ce929d0e0e4736'}-00f067aa0ba902b7-00`

      const span = untraced.startSpan('proxied', { parent: inbound, tracestate: 'vendor=abc' })
      span.end()
      await untraced.shutdown()

      // Echoed verbatim: the ids belong to the upstream caller, which recorded them.
      expect(span.traceparent()).toBe(inbound)
      expect(span.tracestate()).toBe('vendor=abc')
      expect(traceRequests()).toHaveLength(0)
    })

    it('exposes a passed-through trace to getActiveSpan inside withSpan', async () => {
      const untraced = createClient({ traces: undefined })
      const inbound = `00-${'4bf92f3577b34da6a3ce929d0e0e4736'}-00f067aa0ba902b7-01`

      const propagated = await untraced.withSpan('proxied', { parent: inbound }, async () => {
        // After an await, so this also covers the AsyncLocalStorage path.
        await Promise.resolve()
        return untraced.getActiveSpan()?.traceparent()
      })
      await untraced.shutdown()

      expect(propagated).toBe(inbound)
      expect(untraced.getActiveSpan()).toBeNull()
    })
  })

  describe('transport', () => {
    it('posts to /i/v1/traces with bearer auth', async () => {
      posthog.startSpan('checkout').end()
      await flushTraces()

      const [url, init] = traceRequests()[0]
      expect(url).toBe('http://example.com/i/v1/traces')
      expect(init.method).toBe('POST')
      expect(init.headers.Authorization).toBe('Bearer phc_test_key')
      expect(init.headers['Content-Type']).toBe('application/json')
    })

    it('does not put the project key in the query string', async () => {
      posthog.startSpan('checkout').end()
      await flushTraces()

      expect(traceRequests()[0][0]).not.toContain('token=')
    })

    it('sends the service name as a resource attribute', async () => {
      posthog.startSpan('checkout').end()
      await flushTraces()

      // The server reads service_name only from this attribute; without it the
      // spans are stored with an empty service and are unattributable.
      expect(sentPayloads()[0].resourceSpans[0].resource.attributes).toContainEqual({
        key: 'service.name',
        value: { stringValue: 'checkout-api' },
      })
    })

    it('identifies the SDK in the scope and resource', async () => {
      posthog.startSpan('checkout').end()
      await flushTraces()

      const [resourceSpan] = sentPayloads()[0].resourceSpans
      expect(resourceSpan.scopeSpans[0].scope).toEqual({ name: 'posthog-node', version: '1.2.3' })
      expect(resourceSpan.resource.attributes).toContainEqual({
        key: 'telemetry.sdk.name',
        value: { stringValue: 'posthog-node' },
      })
    })

    it('sends the host OS as resource attributes', async () => {
      posthog.startSpan('checkout').end()
      await flushTraces()

      const attributes = sentPayloads()[0].resourceSpans[0].resource.attributes
      expect(attributes).toContainEqual({
        key: 'os.name',
        value: { stringValue: osResourceAttributes(platform(), release())['os.name'] },
      })
      expect(attributes).toContainEqual({ key: 'os.version', value: { stringValue: release() } })
    })

    it('lets configured resourceAttributes override the host OS', async () => {
      posthog = createClient({ traces: { serviceName: 'checkout-api', resourceAttributes: { 'os.name': 'my-os' } } })
      posthog.startSpan('checkout').end()
      await flushTraces()

      expect(sentPayloads()[0].resourceSpans[0].resource.attributes).toContainEqual({
        key: 'os.name',
        value: { stringValue: 'my-os' },
      })
    })
  })

  describe('span shape', () => {
    it('exports well-formed W3C identifiers', async () => {
      posthog.startSpan('checkout').end()
      await flushTraces()

      const [span] = sentSpans()
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(span.spanId).toMatch(/^[0-9a-f]{16}$/)
    })

    it('encodes timestamps as nanosecond strings', async () => {
      posthog.startSpan('checkout').end()
      await flushTraces()

      const [span] = sentSpans()
      expect(typeof span.startTimeUnixNano).toBe('string')
      expect(Number(span.endTimeUnixNano)).toBeGreaterThanOrEqual(Number(span.startTimeUnixNano))
    })

    it('encodes integer attributes as stringified int64', async () => {
      posthog.startSpan('checkout', { attributes: { 'http.status_code': 200 } }).end()
      await flushTraces()

      expect(attributeOf(sentSpans()[0], 'http.status_code')).toEqual({ intValue: '200' })
    })

    it('replaces an empty span name rather than poisoning the batch', async () => {
      // A malformed span 400s the entire request, and 400 is non-retriable —
      // one bad name would silently destroy every other span in the batch.
      posthog.startSpan('').end()
      await flushTraces()

      expect(sentSpans()[0].name).toBe('unknown')
    })
  })

  describe('active span context', () => {
    it('nests spans started inside a withSpan callback', async () => {
      posthog.withSpan('outer', () => {
        posthog.withSpan('inner', () => undefined)
      })
      await flushTraces()

      const inner = sentSpans().find((s) => s.name === 'inner')!
      const outer = sentSpans().find((s) => s.name === 'outer')!
      expect(inner.traceId).toBe(outer.traceId)
      expect(inner.parentSpanId).toBe(outer.spanId)
    })

    it('keeps the span active across an await', async () => {
      // This is what AsyncLocalStorage buys over the synchronous fallback: a
      // span started after an await still nests correctly.
      await posthog.withSpan('outer', async () => {
        await Promise.resolve()
        posthog.withSpan('inner', () => undefined)
      })
      await flushTraces()

      const inner = sentSpans().find((s) => s.name === 'inner')!
      const outer = sentSpans().find((s) => s.name === 'outer')!
      expect(inner.parentSpanId).toBe(outer.spanId)
    })

    it('isolates concurrent requests from each other', async () => {
      await Promise.all([
        posthog.withSpan('request-a', async () => {
          await Promise.resolve()
          posthog.withSpan('child-a', () => undefined)
        }),
        posthog.withSpan('request-b', async () => {
          await Promise.resolve()
          posthog.withSpan('child-b', () => undefined)
        }),
      ])
      await flushTraces()

      const byName = (name: string): OtlpSpan => sentSpans().find((s) => s.name === name)!
      expect(byName('child-a').parentSpanId).toBe(byName('request-a').spanId)
      expect(byName('child-b').parentSpanId).toBe(byName('request-b').spanId)
      expect(byName('request-a').traceId).not.toBe(byName('request-b').traceId)
    })

    it('reads null outside any callback', () => {
      expect(posthog.getActiveSpan()).toBeNull()
    })
  })

  describe('auto-context from the request context', () => {
    it('attaches the request distinct id and session id', async () => {
      // Fed by the Express/NestJS middleware from the X-POSTHOG-DISTINCT-ID and
      // X-POSTHOG-SESSION-ID tracing headers.
      posthog.withContext({ distinctId: 'user-123', sessionId: 'session-123' }, () => {
        posthog.startSpan('checkout').end()
      })
      await flushTraces()

      const [span] = sentSpans()
      expect(attributeOf(span, 'posthogDistinctId')).toEqual({ stringValue: 'user-123' })
      expect(attributeOf(span, 'sessionId')).toEqual({ stringValue: 'session-123' })
    })

    it('omits the keys outside a request context', async () => {
      posthog.startSpan('background-job').end()
      await flushTraces()

      expect(attributeOf(sentSpans()[0], 'posthogDistinctId')).toBeUndefined()
      expect(attributeOf(sentSpans()[0], 'sessionId')).toBeUndefined()
    })
  })

  describe('distributed tracing', () => {
    it('continues a trace from an inbound traceparent header', async () => {
      const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
      const spanId = '00f067aa0ba902b7'

      posthog.withSpan('POST /checkout', { parent: `00-${traceId}-${spanId}-01` }, () => undefined)
      await flushTraces()

      const [span] = sentSpans()
      expect(span.traceId).toBe(traceId)
      expect(span.parentSpanId).toBe(spanId)
    })

    it('produces a traceparent for the next service', async () => {
      let traceparent: string | null = null
      posthog.withSpan('POST /checkout', () => {
        traceparent = posthog.getActiveSpan()!.traceparent()
      })
      await flushTraces()

      const [span] = sentSpans()
      expect(traceparent).toBe(`00-${span.traceId}-${span.spanId}-01`)
    })
  })

  describe('errors', () => {
    it('records a thrown error and rethrows it unchanged', async () => {
      const thrown = new TypeError('boom')
      expect(() =>
        posthog.withSpan('job', () => {
          throw thrown
        })
      ).toThrow(thrown)

      await flushTraces()

      const [span] = sentSpans()
      expect(span.status).toEqual({ code: 2, message: 'boom' })
      expect(span.events?.[0].name).toBe('exception')
    })
  })

  describe('compression', () => {
    it('advertises the encoding exactly when it compresses', async () => {
      const client = createClient({ disableCompression: false })
      client.startSpan('checkout').end()
      await client.shutdown()

      const [, init] = traceRequests()[0]
      // Runtimes without gzip send plain text; a header that disagrees with the
      // body is what 400s the batch, so the two must always match.
      expect(init.headers['Content-Encoding'] === 'gzip').toBe(typeof init.body !== 'string')
      expect(typeof init.body !== 'string').toBe(isGzipSupported())
    })

    it('sends an uncompressed body when compression is disabled', async () => {
      const client = createClient()
      client.startSpan('checkout').end()
      await client.shutdown()

      const [, init] = traceRequests()[0]
      expect(init.headers['Content-Encoding']).toBeUndefined()
      expect(typeof init.body).toBe('string')
    })
  })

  describe('identity resource attributes', () => {
    it('ignores a non-string service.name and keeps the configured one', async () => {
      const client = createClient({
        traces: { serviceName: 'checkout-api', resourceAttributes: { 'service.name': 12345 } },
      })
      client.startSpan('checkout').end()
      await client.shutdown()

      const resource = sentPayloads()[0].resourceSpans[0].resource.attributes
      expect(resource.find((a) => a.key === 'service.name')?.value).toEqual({ stringValue: 'checkout-api' })
    })

    it('ignores a resourceAttributes value that is not an object', async () => {
      const client = createClient({
        traces: { serviceName: 'checkout-api', resourceAttributes: 'oops' as any },
      })
      expect(() => client.startSpan('checkout').end()).not.toThrow()
      await client.shutdown()

      const keys = sentPayloads()[0].resourceSpans[0].resource.attributes.map((a) => a.key)
      // A spread primitive would arrive as attributes keyed "0", "1", "2", "3".
      expect(keys).not.toContain('0')
    })

    it('does not throw when a resourceAttributes accessor throws', () => {
      const hostile = {}
      Object.defineProperty(hostile, 'service.name', {
        enumerable: true,
        get() {
          throw new Error('config getter exploded')
        },
      })
      const client = createClient({ traces: { serviceName: 'checkout-api', resourceAttributes: hostile as any } })

      expect(() => client.startSpan('checkout')).not.toThrow()
    })

    it('falls back to unknown_service when the only service.name is not a string', async () => {
      // Nothing re-emits a valid name here, so this is what actually covers the
      // resolver's type check rather than the encoder's key ordering.
      const client = createClient({ traces: { resourceAttributes: { 'service.name': 12345 } } })
      client.startSpan('checkout').end()
      await client.shutdown()

      const resource = sentPayloads()[0].resourceSpans[0].resource.attributes
      expect(resource.find((a) => a.key === 'service.name')?.value).toEqual({ stringValue: 'unknown_service' })
    })

    it('drops a non-string deployment.environment instead of shipping it as an int', async () => {
      const client = createClient({
        traces: { serviceName: 'checkout-api', resourceAttributes: { 'deployment.environment': 42 } },
      })
      client.startSpan('checkout').end()
      await client.shutdown()

      const resource = sentPayloads()[0].resourceSpans[0].resource.attributes
      expect(resource.find((a) => a.key === 'deployment.environment')).toBeUndefined()
    })

    it('lets a string service.name in resourceAttributes win', async () => {
      const client = createClient({
        traces: { serviceName: 'checkout-api', resourceAttributes: { 'service.name': 'from-attributes' } },
      })
      client.startSpan('checkout').end()
      await client.shutdown()

      const resource = sentPayloads()[0].resourceSpans[0].resource.attributes
      expect(resource.find((a) => a.key === 'service.name')?.value).toEqual({ stringValue: 'from-attributes' })
    })
  })

  describe('413 handling', () => {
    it('halves the batch on a real 413 rather than retrying it forever', async () => {
      // `_sendTracesBatch` classifies the response itself; the core halving
      // logic is dead unless that mapping is right, and every core test mocks
      // the outcome rather than the status.
      let requests = 0
      mockedFetch.mockImplementation(((url: string) => {
        if (!url.includes('/i/v1/traces')) {
          return Promise.resolve({ status: 200, text: () => Promise.resolve('ok') } as any)
        }
        requests++
        return Promise.resolve({
          status: requests === 1 ? 413 : 200,
          text: () => Promise.resolve(requests === 1 ? 'too large' : '{}'),
        } as any)
      }) as any)

      const client = createClient({ traces: { serviceName: 'checkout-api', maxExportBatchSize: 2 } })
      client.startSpan('a').end()
      client.startSpan('b').end()
      await client.shutdown()

      const batchSizes = sentPayloads().map((p) => p.resourceSpans[0].scopeSpans[0].spans.length)
      expect(batchSizes).toEqual([2, 1, 1])
    })
  })

  describe('flush cycle', () => {
    it('drains queued spans', async () => {
      posthog.startSpan('checkout').end()
      await posthog.flush()

      expect(sentSpans()).toHaveLength(1)
    })

    it('resolves when the span export fails', async () => {
      mockedFetch.mockRejectedValue(new Error('network down'))
      posthog.startSpan('checkout').end()

      await expect(posthog.flush()).resolves.toBeUndefined()
    })

    it('still flushes on its own interval', async () => {
      posthog.startSpan('checkout').end()
      await flushTraces()

      expect(sentSpans()).toHaveLength(1)
    })
  })

  describe('serverless waitUntil', () => {
    it('drains spans on the debounced waitUntil flush, not only on shutdown', async () => {
      const waitUntil = vi.fn()
      // High flushAt and a long event interval so the only thing that can flush
      // within the window is the debounced waitUntil cycle.
      const client = createClient({
        waitUntil,
        waitUntilDebounceMs: 50,
        flushAt: 100,
        flushInterval: 60_000,
        traces: { serviceName: 'checkout-api', flushIntervalMs: 60_000 },
      })
      // No capture(): a handler that only traces must still hold the invocation open.
      client.startSpan('handler').end()

      await vi.advanceTimersByTimeAsync(100)
      await waitForPromises()

      expect(waitUntil).toHaveBeenCalled()
      expect(sentSpans().map((span) => span.name)).toEqual(['handler'])
      await client.shutdown()
    })
  })

  describe('shutdown', () => {
    it('is bounded by the shutdown timeout when the transport hangs', async () => {
      const client = createClient()
      client.startSpan('checkout').end()
      mockedFetch.mockImplementation(() => new Promise(() => {}) as any)

      const shutdown = client.shutdown(500)
      await vi.advanceTimersByTimeAsync(600)

      await expect(shutdown).resolves.toBeUndefined()
    })

    it('discards spans whose raced-out flush settles after teardown', async () => {
      let rejectFetch!: (error: Error) => void
      mockedFetch.mockImplementation(() => new Promise((_resolve, reject) => (rejectFetch = reject)) as any)

      const client = createClient()
      client.startSpan('checkout').end()
      const shutdown = client.shutdown(100)
      await vi.advanceTimersByTimeAsync(150)
      await shutdown
      const afterShutdown = traceRequests().length

      rejectFetch(new Error('connection refused'))
      await vi.advanceTimersByTimeAsync(60_000)

      expect(traceRequests()).toHaveLength(afterShutdown)
    })

    it('drains queued spans', async () => {
      posthog.startSpan('a').end()
      posthog.startSpan('b').end()
      await posthog.shutdown()

      expect(sentSpans()).toHaveLength(2)
    })
  })
})
