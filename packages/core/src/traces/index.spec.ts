import { PostHogTraces } from './index'
import { SyncSpanContextManager } from './context'
import { NOOP_SPAN } from './span'
import type {
  OtlpSpan,
  OtlpTracesPayload,
  ResolvedTracesConfig,
  SendTracesBatchOutcome,
  SpanRecord,
  TraceSdkContext,
} from './types'
import type { Logger } from '../types'
import { createMockLogger } from '@/testing'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const REMOTE_SPAN_ID = '00f067aa0ba902b7'

const resolveForTest = (partial?: Partial<ResolvedTracesConfig>): ResolvedTracesConfig => ({
  flushIntervalMs: 5000,
  maxExportBatchSize: 512,
  maxQueueSize: 2048,
  beforeSpanSend: [],
  maxAttributesPerSpan: 128,
  maxEventsPerSpan: 128,
  maxAttributeValueLength: 8192,
  maxLiveSpans: 10000,
  maxSpanAgeMs: 3600000,
  ...partial,
})

const createMockInstance = (overrides: Record<string, any> = {}): any => ({
  isDisabled: false,
  optedOut: false,
  getLibraryId: vi.fn(() => 'posthog-core-tests'),
  getLibraryVersion: vi.fn(() => '0.0.0-test'),
  _sendTracesBatch: vi.fn((): Promise<SendTracesBatchOutcome> => Promise.resolve({ kind: 'ok' })),
  ...overrides,
})

describe('PostHogTraces', () => {
  let mockInstance: any
  let logger: Logger
  let context: TraceSdkContext

  const createTraces = (config?: Partial<ResolvedTracesConfig>, instance?: any): PostHogTraces =>
    new PostHogTraces(
      instance ?? mockInstance,
      resolveForTest(config),
      logger,
      () => context,
      new SyncSpanContextManager()
    )

  const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve()
    }
  }

  const sentPayloads = (instance?: any): OtlpTracesPayload[] =>
    (instance ?? mockInstance)._sendTracesBatch.mock.calls.map((c: any[]) => c[0])

  const sentSpans = (instance?: any): OtlpSpan[] =>
    sentPayloads(instance).flatMap((p) => p.resourceSpans[0].scopeSpans[0].spans)

  beforeEach(() => {
    mockInstance = createMockInstance()
    logger = createMockLogger()
    context = {}
  })

  describe('startSpan', () => {
    it('enqueues exactly one record per span', async () => {
      const traces = createTraces()
      traces.startSpan('checkout').end()
      await traces.flush()

      expect(sentSpans()).toHaveLength(1)
      expect(sentSpans()[0].name).toBe('checkout')
    })

    it('gives a root span a fresh trace id and no parent', async () => {
      const traces = createTraces()
      traces.startSpan('root').end()
      await traces.flush()

      const [span] = sentSpans()
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(span.spanId).toMatch(/^[0-9a-f]{16}$/)
      expect(span.parentSpanId).toBeUndefined()
    })

    it('does not activate the span it returns', () => {
      const traces = createTraces()
      const manual = traces.startSpan('manual')
      expect(traces.getActiveSpan()).toBeNull()
      manual.end()
    })

    it('parents a child to an explicit span handle', async () => {
      const traces = createTraces()
      const parent = traces.startSpan('parent')
      const child = traces.startSpan('child', { parent })
      child.end()
      parent.end()
      await traces.flush()

      const [childSpan, parentSpan] = sentSpans()
      expect(childSpan.traceId).toBe(parentSpan.traceId)
      expect(childSpan.parentSpanId).toBe(parentSpan.spanId)
    })

    it('defaults kind to internal and honours an explicit kind', async () => {
      const traces = createTraces()
      traces.startSpan('a').end()
      traces.startSpan('b', { kind: 'server' }).end()
      await traces.flush()

      expect(sentSpans().map((s) => s.kind)).toEqual([1, 2])
    })

    it('returns an inert handle when the SDK is disabled', async () => {
      const traces = createTraces({}, createMockInstance({ isDisabled: true }))
      const span = traces.startSpan('checkout')
      span.end()

      expect(span).toBe(NOOP_SPAN)
      expect(span.traceparent()).toBeNull()
    })

    it('returns an inert handle when the user has opted out', () => {
      const traces = createTraces({}, createMockInstance({ optedOut: true }))
      expect(traces.startSpan('checkout')).toBe(NOOP_SPAN)
    })

    it('makes a child of a no-op handle a no-op rather than an orphan', () => {
      const traces = createTraces()
      expect(traces.startSpan('child', { parent: NOOP_SPAN })).toBe(NOOP_SPAN)
    })
  })

  describe('startTime', () => {
    it('backdates the span to a supplied start', async () => {
      const traces = createTraces()
      const start = Date.now() - 60_000
      traces.startSpan('backdated', { startTime: start }).end()
      await traces.flush()

      expect(sentSpans()[0].startTimeUnixNano).toBe(`${start}000000`)
    })

    it('accepts a Date', async () => {
      const traces = createTraces()
      const start = new Date(Date.now() - 5_000)
      traces.startSpan('backdated', { startTime: start }).end()
      await traces.flush()

      expect(sentSpans()[0].startTimeUnixNano).toBe(`${start.getTime()}000000`)
    })

    it('falls back to now for an unusable start, keeping the record well formed', async () => {
      const traces = createTraces()
      traces.startSpan('bad', { startTime: Number.NaN }).end()
      await traces.flush()

      const [span] = sentSpans()
      expect(span.startTimeUnixNano).toMatch(/^\d+$/)
      expect(Number(span.endTimeUnixNano)).toBeGreaterThanOrEqual(Number(span.startTimeUnixNano))
    })

    it('warns when a start is old enough for the server to clamp it', async () => {
      const traces = createTraces()
      traces.startSpan('stale', { startTime: Date.now() - 48 * 60 * 60 * 1000 }).end()
      await traces.flush()

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('24 hours'))
      expect(sentSpans()).toHaveLength(1)
    })
  })

  describe('trace continuation', () => {
    it('continues a remote trace from a traceparent string', async () => {
      const traces = createTraces()
      traces.startSpan('handler', { parent: `00-${TRACE_ID}-${REMOTE_SPAN_ID}-01` }).end()
      await traces.flush()

      const [span] = sentSpans()
      expect(span.traceId).toBe(TRACE_ID)
      expect(span.parentSpanId).toBe(REMOTE_SPAN_ID)
    })

    it('continues a trace the caller sampled out', async () => {
      const traces = createTraces()
      traces.startSpan('handler', { parent: `00-${TRACE_ID}-${REMOTE_SPAN_ID}-00` }).end()
      await traces.flush()

      expect(sentSpans()[0].traceId).toBe(TRACE_ID)
    })

    it('propagates the sampled-out flag onward rather than upgrading it to 01', async () => {
      // A downstream parent-based sampler would otherwise record a trace its own
      // head sampler had already rejected.
      const traces = createTraces()
      const span = traces.startSpan('handler', { parent: `00-${TRACE_ID}-${REMOTE_SPAN_ID}-00` })
      const child = traces.startSpan('inner', { parent: span })

      expect(span.traceparent()!.startsWith(`00-${TRACE_ID}-`)).toBe(true)
      expect(span.traceparent()!.endsWith('-00')).toBe(true)
      // The whole chain agrees, not just the span that read the header.
      expect(child.traceparent()!.endsWith('-00')).toBe(true)

      child.end()
      span.end()
      await traces.flush()

      // Recorded and exported all the same, with the wire agreeing with the header.
      const byName = Object.fromEntries(sentSpans().map((sent) => [sent.name, sent.flags]))
      expect(byName).toEqual({ handler: 0x300, inner: 0x100 })
    })

    it('marks a header parent remote and a handle parent local', async () => {
      const traces = createTraces()
      const remote = traces.startSpan('handler', { parent: `00-${TRACE_ID}-${REMOTE_SPAN_ID}-01` })
      const local = traces.startSpan('inner', { parent: remote })

      local.end()
      remote.end()
      await traces.flush()

      const byName = Object.fromEntries(sentSpans().map((span) => [span.name, span.flags]))
      expect(byName).toEqual({ handler: 0x301, inner: 0x101 })
    })

    it('preserves tracestate opaquely and passes it to children', async () => {
      const traces = createTraces()
      const parent = traces.startSpan('handler', {
        parent: `00-${TRACE_ID}-${REMOTE_SPAN_ID}-01`,
        tracestate: 'vendor=abc',
      })
      const child = traces.startSpan('inner', { parent })
      expect(parent.tracestate()).toBe('vendor=abc')

      child.end()
      parent.end()
      await traces.flush()

      expect(sentSpans().map((s) => s.traceState)).toEqual(['vendor=abc', 'vendor=abc'])
    })

    it('starts a fresh root on a malformed traceparent without throwing', async () => {
      const traces = createTraces()
      expect(() => traces.startSpan('handler', { parent: 'garbage' }).end()).not.toThrow()
      await traces.flush()

      const [span] = sentSpans()
      expect(span.traceId).not.toBe(TRACE_ID)
      expect(span.parentSpanId).toBeUndefined()
    })

    it('starts a fresh root when the parent is not a span, as a duplicated header is', async () => {
      const traces = createTraces()
      traces.startSpan('handler', { parent: [`00-${TRACE_ID}-${REMOTE_SPAN_ID}-01`] as unknown as string }).end()
      await traces.flush()

      const [span] = sentSpans()
      expect(span.traceId).not.toBe(TRACE_ID)
      expect(span.parentSpanId).toBeUndefined()
    })

    it('parents to the active span when the parent is not a span', async () => {
      const traces = createTraces()
      traces.withSpan('handler', () => {
        traces.startSpan('child', { parent: [`00-${TRACE_ID}-${REMOTE_SPAN_ID}-01`] as unknown as string }).end()
      })
      await traces.flush()

      const child = sentSpans().find((s) => s.name === 'child')!
      const handler = sentSpans().find((s) => s.name === 'handler')!
      expect(child.traceId).toBe(handler.traceId)
      expect(child.parentSpanId).toBe(handler.spanId)
    })
  })

  describe('withSpan', () => {
    it('ends the span and returns the callback result', async () => {
      const traces = createTraces()
      const result = traces.withSpan('job', () => 'value')
      await traces.flush()

      expect(result).toBe('value')
      expect(sentSpans()).toHaveLength(1)
      expect(sentSpans()[0].status).toBeUndefined()
    })

    it('accepts options before the callback', async () => {
      const traces = createTraces()
      traces.withSpan('job', { kind: 'server', attributes: { plan: 'pro' } }, () => undefined)
      await traces.flush()

      const [span] = sentSpans()
      expect(span.kind).toBe(2)
      expect(span.attributes).toContainEqual({ key: 'plan', value: { stringValue: 'pro' } })
    })

    it('runs the callback when an attribute getter throws', async () => {
      const traces = createTraces()
      const attributes: any = { ok: 1 }
      Object.defineProperty(attributes, 'boom', {
        enumerable: true,
        get() {
          throw new Error('getter exploded')
        },
      })

      expect(traces.withSpan('job', { attributes }, () => 'value')).toBe('value')
      await traces.flush()

      expect(sentSpans().map((s) => s.name)).toEqual(['job'])
    })

    it('makes the span active for the callback', () => {
      const traces = createTraces()
      traces.withSpan('outer', (span) => {
        expect(traces.getActiveSpan()).toBe(span)
      })
      expect(traces.getActiveSpan()).toBeNull()
    })

    it('nests spans started inside the callback', async () => {
      const traces = createTraces()
      traces.withSpan('outer', () => {
        traces.withSpan('inner', () => undefined)
      })
      await traces.flush()

      const inner = sentSpans().find((s) => s.name === 'inner')!
      const outer = sentSpans().find((s) => s.name === 'outer')!
      expect(inner.traceId).toBe(outer.traceId)
      expect(inner.parentSpanId).toBe(outer.spanId)
    })

    it('lets an explicit parent override the active span', async () => {
      const traces = createTraces()
      const detached = traces.startSpan('detached')
      traces.withSpan('outer', () => {
        traces.withSpan('inner', { parent: detached }, () => undefined)
      })
      detached.end()
      await traces.flush()

      const inner = sentSpans().find((s) => s.name === 'inner')!
      const detachedSpan = sentSpans().find((s) => s.name === 'detached')!
      expect(inner.parentSpanId).toBe(detachedSpan.spanId)
    })

    it('records a thrown error and rethrows it unmodified', async () => {
      const traces = createTraces()
      const thrown = new TypeError('boom')

      expect(() =>
        traces.withSpan('job', () => {
          throw thrown
        })
      ).toThrow(thrown)

      await traces.flush()
      const [span] = sentSpans()
      expect(span.status).toEqual({ code: 2, message: 'boom' })
      expect(span.events?.[0]).toMatchObject({
        name: 'exception',
        attributes: [
          { key: 'exception.type', value: { stringValue: 'TypeError' } },
          { key: 'exception.message', value: { stringValue: 'boom' } },
          { key: 'exception.stacktrace', value: { stringValue: expect.stringContaining('TypeError: boom') } },
        ],
      })
    })

    it('ends an async callback at settle, not when it returns its promise', async () => {
      const traces = createTraces({ maxExportBatchSize: 1 })
      let finishWork!: () => void
      const work = new Promise<void>((resolve) => {
        finishWork = resolve
      })

      const pending = traces.withSpan('job', () => work)

      await Promise.resolve()
      expect(mockInstance._sendTracesBatch).not.toHaveBeenCalled()

      finishWork()
      await pending
      await traces.flush()

      expect(sentSpans()).toHaveLength(1)
    })

    it('covers the awaited duration', async () => {
      const traces = createTraces()
      const pending = traces.withSpan('job', async () => {
        await new Promise((resolve) => setTimeout(resolve, 80))
      })
      await vi.advanceTimersByTimeAsync(80)
      await pending
      await traces.flush()

      const [span] = sentSpans()
      expect(Number(span.endTimeUnixNano)).toBeGreaterThan(Number(span.startTimeUnixNano))
    })

    it('records a rejection and rethrows it unmodified', async () => {
      const traces = createTraces()
      const thrown = new Error('async boom')

      await expect(traces.withSpan('job', async () => Promise.reject(thrown))).rejects.toBe(thrown)

      await traces.flush()
      expect(sentSpans()[0].status).toEqual({ code: 2, message: 'async boom' })
    })

    it('treats an explicit ok status as final when the callback throws', async () => {
      const traces = createTraces()
      expect(() =>
        traces.withSpan('job', (span) => {
          span.setStatus('ok')
          throw new Error('boom')
        })
      ).toThrow('boom')

      await traces.flush()
      const [span] = sentSpans()
      expect(span.status).toEqual({ code: 1 })
      // The exception event is still attached — only the status is protected.
      expect(span.events?.[0].name).toBe('exception')
    })

    it('runs the callback once with an inert handle when tracing cannot run', async () => {
      const traces = createTraces({}, createMockInstance({ optedOut: true }))
      const fn = vi.fn(() => 'value')

      expect(traces.withSpan('job', fn)).toBe('value')
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith(NOOP_SPAN)
      expect(traces.getActiveSpan()).toBeNull()
      await traces.flush()
      expect(sentSpans()).toHaveLength(0)
    })
  })

  // A service in the middle of a traced chain must not sever it just because it
  // has no tracing of its own — OTel requires the API to carry the parent
  // context through when no SDK is recording.
  describe('trace context pass-through when tracing is off', () => {
    const INBOUND_UNSAMPLED = `00-${TRACE_ID}-${REMOTE_SPAN_ID}-00`

    it('echoes an inbound traceparent, flags included, when the SDK is disabled', async () => {
      const instance = createMockInstance({ isDisabled: true })
      const traces = createTraces({}, instance)

      const span = traces.startSpan('proxied', { parent: INBOUND_UNSAMPLED, tracestate: 'vendor=abc' })
      span.end()
      await traces.flush()

      expect(span.traceparent()).toBe(INBOUND_UNSAMPLED)
      expect(span.tracestate()).toBe('vendor=abc')
      expect(sentSpans(instance)).toHaveLength(0)
    })

    it('echoes an inbound traceparent when the user has opted out', () => {
      const traces = createTraces({}, createMockInstance({ optedOut: true }))
      const span = traces.startSpan('proxied', { parent: `00-${TRACE_ID}-${REMOTE_SPAN_ID}-01` })

      expect(span.traceparent()).toBe(`00-${TRACE_ID}-${REMOTE_SPAN_ID}-01`)
    })

    it('activates the pass-through handle so getActiveSpan can propagate it', () => {
      const traces = createTraces({}, createMockInstance({ optedOut: true }))

      const propagated = traces.withSpan('proxied', { parent: INBOUND_UNSAMPLED }, () =>
        traces.getActiveSpan()?.traceparent()
      )

      expect(propagated).toBe(INBOUND_UNSAMPLED)
      expect(traces.getActiveSpan()).toBeNull()
    })

    it('passes the inbound context through when the live-span limit refuses the span', () => {
      const traces = createTraces({ maxLiveSpans: 1 })
      traces.startSpan('holds-the-only-slot')

      const refused = traces.startSpan('refused', { parent: INBOUND_UNSAMPLED })

      expect(refused.traceparent()).toBe(INBOUND_UNSAMPLED)
    })

    it('has nothing to propagate without a usable parent', () => {
      const traces = createTraces({}, createMockInstance({ optedOut: true }))

      expect(traces.startSpan('no-parent')).toBe(NOOP_SPAN)
      expect(traces.startSpan('bad-parent', { parent: 'not-a-traceparent' })).toBe(NOOP_SPAN)
    })
  })

  describe('auto-context', () => {
    it('attaches the distinct id and session id as the product join keys', async () => {
      context = { distinctId: 'user-123', sessionId: 'session-123' }
      const traces = createTraces()
      traces.startSpan('checkout').end()
      await traces.flush()

      expect(sentSpans()[0].attributes).toEqual(
        expect.arrayContaining([
          { key: 'posthogDistinctId', value: { stringValue: 'user-123' } },
          { key: 'sessionId', value: { stringValue: 'session-123' } },
        ])
      )
    })

    it('omits keys with no value', async () => {
      context = { distinctId: 'user-123' }
      const traces = createTraces()
      traces.startSpan('checkout').end()
      await traces.flush()

      expect(sentSpans()[0].attributes?.map((a) => a.key)).toEqual(['posthogDistinctId'])
    })

    it('freezes the snapshot at span start', async () => {
      context = { distinctId: 'a' }
      const traces = createTraces()
      const span = traces.startSpan('checkout')
      context = { distinctId: 'b' }
      span.end()
      await traces.flush()

      expect(sentSpans()[0].attributes).toContainEqual({
        key: 'posthogDistinctId',
        value: { stringValue: 'a' },
      })
    })

    it('lets user attributes win on collision', async () => {
      context = { distinctId: 'a' }
      const traces = createTraces()
      traces.startSpan('checkout', { attributes: { posthogDistinctId: 'override' } }).end()
      await traces.flush()

      expect(sentSpans()[0].attributes).toContainEqual({
        key: 'posthogDistinctId',
        value: { stringValue: 'override' },
      })
    })

    it('maps the client-platform navigation keys', async () => {
      context = { currentUrl: 'https://example.com/cart', screenName: 'Cart', appState: 'foreground' }
      const traces = createTraces()
      traces.startSpan('checkout').end()
      await traces.flush()

      const attributes = sentSpans()[0].attributes ?? []
      expect(attributes).toEqual(
        expect.arrayContaining([
          { key: 'url.full', value: { stringValue: 'https://example.com/cart' } },
          { key: 'screen.name', value: { stringValue: 'Cart' } },
          { key: 'app.state', value: { stringValue: 'foreground' } },
        ])
      )
    })

    it('still records the span when reading context throws', async () => {
      const traces = new PostHogTraces(
        mockInstance,
        resolveForTest(),
        logger,
        () => {
          throw new Error('no context')
        },
        new SyncSpanContextManager()
      )
      traces.startSpan('checkout').end()
      await traces.flush()

      expect(sentSpans()).toHaveLength(1)
    })
  })

  describe('gating', () => {
    it('drops a span whose user opted out mid-trace, without throwing', async () => {
      const instance = createMockInstance()
      const traces = createTraces({}, instance)
      const span = traces.startSpan('checkout')

      instance.optedOut = true
      expect(() => span.end()).not.toThrow()

      await traces.flush()
      expect(instance._sendTracesBatch).not.toHaveBeenCalled()
    })

    it('counts a span dropped at the end-time gate', async () => {
      const instance = createMockInstance()
      const traces = createTraces({}, instance)
      const span = traces.startSpan('checkout')

      instance.optedOut = true
      span.end()
      await traces.flush()

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the user has opted out'))
    })
  })

  describe('reset', () => {
    it('says so when it discards queued spans', async () => {
      // Terminal loss: there is no next flush to retry on, and the export
      // failure the caller already saw promises one.
      const instance = createMockInstance({
        _sendTracesBatch: vi.fn(() => Promise.resolve({ kind: 'retry-later' as const, error: new Error('down') })),
      })
      const traces = createTraces({}, instance)
      traces.startSpan('a').end()
      traces.startSpan('b').end()
      await traces.flush()

      traces.reset()

      expect(logger.critical).toHaveBeenCalledWith(expect.stringContaining('Discarding 2 span(s)'))
    })

    it('stays quiet when nothing was queued', () => {
      const traces = createTraces()

      traces.reset()

      expect(logger.critical).not.toHaveBeenCalled()
    })
  })

  describe('flush reentrancy', () => {
    it('does not re-send the head batch when a span ends during the flush prefix', async () => {
      // `_flushInner` runs synchronously as far as its first await, and it reads
      // the resource attributes in that window. A getter there that ends a span
      // used to re-enter the flush with no pass yet recorded, and the same head
      // batch went out again on every pass — thousands of times, unbounded.
      const resourceAttributes: Record<string, unknown> = {}
      Object.defineProperty(resourceAttributes, 'tenant', {
        enumerable: true,
        // Reads `traces` only when a flush runs, which is after it is assigned.
        get: () => {
          traces.startSpan('late').end()
          return 'acme'
        },
      })
      const instance = createMockInstance()
      const traces = createTraces({ maxExportBatchSize: 2, resourceAttributes }, instance)

      traces.startSpan('a').end()
      traces.startSpan('b').end()
      await traces.flush()
      await traces.flush()

      expect(sentPayloads(instance)).toHaveLength(2)
      expect(sentSpans(instance).map((s) => s.name)).toEqual(['a', 'b', 'late'])
    })
  })

  describe('beforeSpanSend', () => {
    const endOneSpan = (beforeSpanSend: any): PostHogTraces => {
      const traces = createTraces({ beforeSpanSend: [beforeSpanSend].flat() })
      traces.startSpan('checkout', { attributes: { userId: 42 } }).end()
      return traces
    }

    it('drops a span when the hook returns null', async () => {
      await endOneSpan(() => null).flush()
      expect(sentSpans()).toHaveLength(0)
    })

    it('drops the span when the hook throws', async () => {
      await endOneSpan(() => {
        throw new Error('scrubber broke')
      }).flush()

      expect(sentSpans()).toHaveLength(0)
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('beforeSpanSend failed'), expect.anything())
    })

    it('counts a span the hook dropped', async () => {
      await endOneSpan(() => null).flush()
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('beforeSpanSend dropped it'))
    })

    it('counts a span dropped because the hook threw', async () => {
      // A permanently broken scrubber otherwise drops every span with the drop
      // counter reading zero.
      await endOneSpan(() => {
        throw new Error('scrubber broke')
      }).flush()

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('beforeSpanSend failed'))
    })

    it('hands the hook plain values, not the OTLP encoding', () => {
      const seen: unknown[] = []
      endOneSpan((span: SpanRecord) => {
        seen.push(span.attributes.userId)
        return span
      })

      expect(seen).toEqual([42])
    })

    it('keeps the original ids when a hook rewrites them', async () => {
      const traces = createTraces({
        beforeSpanSend: [
          (span: any) => {
            span.traceId = '0'.repeat(32)
            span.spanId = '1'.repeat(16)
            return span
          },
        ],
      })
      const started = traces.startSpan('checkout')
      const originalTraceId = started.traceparent()!.split('-')[1]
      started.end()
      await traces.flush()

      const [span] = sentSpans()
      expect(span.traceId).toBe(originalTraceId)
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('identity field'))
    })

    it('exports a span whose record the hook froze', async () => {
      // A defensive hook may freeze what it returns. Assigning to a frozen
      // property throws even when the value is the one already there, so the
      // post-hook pass works on a copy — otherwise every span the hook saw is
      // dropped by the fail-closed branch, with only a debug line to say so.
      const traces = createTraces({
        beforeSpanSend: [(span: SpanRecord) => Object.freeze({ ...span, attributes: { route: '/checkout' } })],
      })
      const span = traces.startSpan('checkout')

      expect(() => span.end()).not.toThrow()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.attributes!.map((attribute) => attribute.key)).toEqual(['route'])
    })

    it('exports a span whose attributes the hook froze', async () => {
      const traces = createTraces({
        maxAttributesPerSpan: 1,
        beforeSpanSend: [
          (span: SpanRecord) => ({ ...span, attributes: Object.freeze({ route: '/checkout', extra: 1 }) as never }),
        ],
      })
      traces.startSpan('checkout').end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.attributes!.map((attribute) => attribute.key)).toEqual(['route'])
      expect(sent.droppedAttributesCount).toBe(1)
    })

    it('rejects a timestamp the server could not decode', async () => {
      const instance = createMockInstance()
      const traces = createTraces(
        { beforeSpanSend: [(span: SpanRecord) => ({ ...span, startTime: span.startTime * 1e6 })] },
        instance
      )
      traces.startSpan('poison').end()
      await traces.flush()

      const [span] = sentSpans(instance)
      expect(span.startTimeUnixNano.length).toBeLessThanOrEqual(19)
    })

    it('keeps tracestate a rebuilding hook would have dropped', async () => {
      const instance = createMockInstance()
      const traces = createTraces(
        { beforeSpanSend: [(span: SpanRecord) => ({ ...span, traceState: undefined }) as SpanRecord] },
        instance
      )
      traces.startSpan('child', { parent: `00-${TRACE_ID}-${REMOTE_SPAN_ID}-01`, tracestate: 'vendor=abc' }).end()
      await traces.flush()

      expect(sentSpans(instance)[0].traceState).toBe('vendor=abc')
    })

    it('keeps the trace flags and parent remoteness a rebuilding hook would have dropped', async () => {
      const instance = createMockInstance()
      const traces = createTraces({ beforeSpanSend: [(span: SpanRecord) => ({ ...span }) as SpanRecord] }, instance)
      traces.startSpan('child', { parent: `00-${TRACE_ID}-${REMOTE_SPAN_ID}-00` }).end()
      await traces.flush()

      // Sampled-out inbound flag, plus both remoteness bits for a header parent.
      expect(sentSpans(instance)[0].flags).toBe(0x300)
    })

    it('keeps them when the hook builds its record from the fields it can see', async () => {
      // Spreading carries the propagation fields through even though no public
      // type declares them; naming the public fields is what drops them.
      const instance = createMockInstance()
      const traces = createTraces(
        {
          beforeSpanSend: [
            (span: SpanRecord) =>
              ({
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                kind: span.kind,
                status: span.status,
                attributes: span.attributes,
                events: span.events,
                startTime: span.startTime,
                endTime: span.endTime,
              }) as SpanRecord,
          ],
        },
        instance
      )
      traces.startSpan('child', { parent: `00-${TRACE_ID}-${REMOTE_SPAN_ID}-00` }).end()
      await traces.flush()

      expect(sentSpans(instance)[0].flags).toBe(0x300)
    })

    it('keeps them when the rebuilding hook also freezes what it returns', async () => {
      // Restoring these onto the returned record would throw here, and a throwing
      // hook drops the span.
      const instance = createMockInstance()
      const traces = createTraces(
        { beforeSpanSend: [(span: SpanRecord) => Object.freeze({ ...span }) as SpanRecord] },
        instance
      )
      traces.startSpan('child', { parent: `00-${TRACE_ID}-${REMOTE_SPAN_ID}-00` }).end()
      await traces.flush()

      expect(sentSpans(instance).map((s) => s.flags)).toEqual([0x300])
    })

    it('does not resurrect a prototype-named attribute the hook removed', async () => {
      // `key in attributes` walks the prototype chain, so a deleted `constructor`
      // read back as the inherited function and shipped as [Function].
      const instance = createMockInstance()
      const traces = createTraces(
        {
          beforeSpanSend: [
            (span: SpanRecord) => {
              delete (span.attributes as Record<string, unknown>).constructor
              return span
            },
          ],
        },
        instance
      )
      const span = traces.startSpan('ghost')
      span.setAttribute('constructor', 'user-value')
      span.setAttribute('safe', 'ok')
      span.end()
      await traces.flush()

      expect(sentSpans(instance)[0].attributes.map((a) => a.key)).toEqual(['safe'])
    })

    it('does not let prototype-named ghosts evict what the hook kept', async () => {
      // Worse than resurrection: at the cap the ghosts won the slots and the
      // attribute the hook deliberately kept was the one dropped.
      const instance = createMockInstance()
      const traces = createTraces(
        {
          maxAttributesPerSpan: 2,
          beforeSpanSend: [(span: SpanRecord) => ({ ...span, attributes: { onlyThis: 'yes' } }) as SpanRecord],
        },
        instance
      )
      const span = traces.startSpan('ghosts')
      span.setAttribute('toString', 1)
      span.setAttribute('valueOf', 2)
      span.end()
      await traces.flush()

      expect(sentSpans(instance)[0].attributes.map((a) => a.key)).toEqual(['onlyThis'])
    })

    it('keeps the earliest-set attributes when the hook adds an integer-like key', async () => {
      // Object.keys hoists integer-like keys whatever the write order, so a key
      // the hook added last outranked one the caller set before it ran.
      const instance = createMockInstance()
      const traces = createTraces(
        {
          maxAttributesPerSpan: 3,
          beforeSpanSend: [
            (span: SpanRecord) => {
              span.attributes['0'] = 'added-last'
              return span
            },
          ],
        },
        instance
      )
      const span = traces.startSpan('ordered')
      span.setAttribute('alpha', 1)
      span.setAttribute('beta', 2)
      span.setAttribute('gamma', 3)
      span.end()
      await traces.flush()

      expect(sentSpans(instance)[0].attributes.map((a) => a.key)).toEqual(['alpha', 'beta', 'gamma'])
    })

    it('ignores a forged identity from a frozen hook rather than dropping the span', async () => {
      // Writing the id back onto a frozen return throws, and a throwing hook
      // drops the span, so forging plus freezing used to lose every span.
      const instance = createMockInstance()
      const traces = createTraces(
        { beforeSpanSend: [(span: SpanRecord) => Object.freeze({ ...span, traceId: '0'.repeat(32) }) as SpanRecord] },
        instance
      )
      traces.startSpan('forged').end()
      await traces.flush()

      expect(sentSpans(instance)).toHaveLength(1)
      expect(sentSpans(instance)[0].traceId).not.toBe('0'.repeat(32))
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('keeping the original ids'))
    })

    it('exports a child span whose record a frozen hook rebuilt without the parent id', async () => {
      // The shape that loses children but keeps roots: a rebuilt record has no
      // parentSpanId to match, so restoring it wrote to a frozen object.
      const instance = createMockInstance()
      const traces = createTraces(
        {
          beforeSpanSend: [
            (span: SpanRecord) =>
              Object.freeze({
                traceId: span.traceId,
                spanId: span.spanId,
                name: span.name,
                kind: span.kind,
                attributes: span.attributes,
                events: span.events,
                startTime: span.startTime,
                endTime: span.endTime,
              }) as SpanRecord,
          ],
        },
        instance
      )
      const root = traces.startSpan('root')
      traces.startSpan('child', { parent: root }).end()
      root.end()
      await traces.flush()

      expect(
        sentSpans(instance)
          .map((s) => s.name)
          .sort()
      ).toEqual(['child', 'root'])
    })

    it('runs hooks left to right and stops at the first null', async () => {
      const order: string[] = []
      await endOneSpan([
        (span: SpanRecord) => {
          order.push('first')
          return span
        },
        () => {
          order.push('second')
          return null
        },
        (span: SpanRecord) => {
          order.push('third')
          return span
        },
      ]).flush()

      expect(order).toEqual(['first', 'second'])
      expect(sentSpans()).toHaveLength(0)
    })

    it('exports the edits a hook made', async () => {
      await endOneSpan((span: SpanRecord) => {
        delete span.attributes.userId
        span.name = 'redacted'
        return span
      }).flush()

      const [span] = sentSpans()
      expect(span.name).toBe('redacted')
      expect(span.attributes?.find((attribute) => attribute.key === 'userId')).toBeUndefined()
    })
  })

  describe('beforeSpanSend validity', () => {
    it('sanitises an event the hook pushed without a timestamp', async () => {
      const traces = createTraces({
        beforeSpanSend: [
          (span) => {
            span.events.push({ name: 'audited' } as never)
            return span
          },
        ],
      })
      traces.startSpan('checkout').end()
      await traces.flush()

      const [event] = sentSpans()[0].events!
      expect(event.name).toBe('audited')
      expect(event.timeUnixNano).toMatch(/^\d+$/)
    })

    it('clamps an out-of-range timestamp on a hook-supplied event', async () => {
      const traces = createTraces({
        beforeSpanSend: [
          (span) => {
            span.events.push({ name: 'audited', timestamp: -1 } as never)
            return span
          },
        ],
      })
      traces.startSpan('checkout').end()
      await traces.flush()

      expect(sentSpans()[0].events![0].timeUnixNano).toMatch(/^\d+$/)
    })

    it('bounds a status message the hook rewrote', async () => {
      const traces = createTraces({
        maxAttributeValueLength: 4,
        beforeSpanSend: [
          (span) => {
            span.status = { code: 'error', message: 'abcdefgh' }
            return span
          },
        ],
      })
      traces.startSpan('checkout').end()
      await traces.flush()

      expect(sentSpans()[0].status).toEqual({ code: 2, message: 'abcd' })
    })

    it('keeps the original status when the hook writes an unknown code', async () => {
      // An unknown code maps to nothing and encodes as an empty status object,
      // which silently loses an error the span really had.
      const traces = createTraces({
        beforeSpanSend: [(span) => ({ ...span, status: { code: 'ERROR' as never, message: 'boom' } })],
      })
      const span = traces.startSpan('checkout')
      span.setStatus('error', 'boom')
      span.end()
      await traces.flush()

      expect(sentSpans()[0].status).toEqual({ code: 2, message: 'boom' })
    })

    it('ignores a dropped count the hook invented', async () => {
      const traces = createTraces({
        beforeSpanSend: [(span) => ({ ...span, droppedAttributesCount: 'lots' as never })],
      })
      traces.startSpan('checkout').end()
      await traces.flush()

      expect(sentSpans()[0].droppedAttributesCount).toBeUndefined()
    })

    it('lets a hook scrub the auto-context keys', async () => {
      // The exemption is from the count cap only. A hook is the documented
      // scrubbing point, so it has to be able to remove the join keys as well.
      context = { distinctId: 'user-1', sessionId: 'session-1' }
      const traces = createTraces({
        beforeSpanSend: [
          (span) => {
            delete span.attributes.posthogDistinctId
            delete span.attributes.sessionId
            return span
          },
        ],
      })
      traces.startSpan('checkout').end()
      await traces.flush()

      expect(sentSpans()[0].attributes).toBeUndefined()
    })

    it('keeps the exception event when the hook pushes past the event cap', async () => {
      // The re-apply used to slice to the first `maxEvents`, and an exception
      // event is the last thing on a span that threw — exactly what a slice cuts.
      const traces = createTraces({
        maxEventsPerSpan: 1,
        beforeSpanSend: [
          (span) => {
            span.events.push({ name: 'audited', timestamp: Date.now() })
            return span
          },
        ],
      })
      const span = traces.startSpan('checkout')
      span.addEvent('step')
      span.recordException(new Error('boom'))
      span.end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.events!.map((event) => event.name)).toEqual(['step', 'exception'])
      expect(sent.droppedEventsCount).toBe(1)
      expect(sent.status).toEqual({ code: 2, message: 'boom' })
    })

    it('keeps the original status when the hook mutates the code in place', async () => {
      // The hook is documented as editing the record in place, so snapshotting a
      // reference to `status` would restore the mutation onto itself.
      const traces = createTraces({
        beforeSpanSend: [
          (span) => {
            ;(span.status as { code: string }).code = 'ERROR'
            return span
          },
        ],
      })
      const span = traces.startSpan('checkout')
      span.setStatus('error', 'boom')
      span.end()
      await traces.flush()

      expect(sentSpans()[0].status).toEqual({ code: 2, message: 'boom' })
    })

    it('exports a span whose record is a class instance with prototype getters', async () => {
      // A spread copies own properties only, so `events` behind a prototype
      // getter arrived undefined and the fail-closed branch ate every span.
      class Wrapped {
        constructor(private readonly _inner: SpanRecord) {}
        get traceId(): string {
          return this._inner.traceId
        }
        get spanId(): string {
          return this._inner.spanId
        }
        get name(): string {
          return this._inner.name
        }
        get kind(): SpanRecord['kind'] {
          return this._inner.kind
        }
        get attributes(): SpanRecord['attributes'] {
          return this._inner.attributes
        }
        get events(): SpanRecord['events'] {
          return this._inner.events
        }
        get startTime(): number {
          return this._inner.startTime
        }
        get endTime(): number {
          return this._inner.endTime
        }
      }
      const traces = createTraces({
        beforeSpanSend: [(span: SpanRecord) => new Wrapped(span) as unknown as SpanRecord],
      })
      traces.startSpan('checkout').end()
      await traces.flush()

      expect(sentSpans().map((span) => span.name)).toEqual(['checkout'])
    })

    it('survives a hook that leaves a hole in the events array', async () => {
      const traces = createTraces({
        beforeSpanSend: [
          (span) => {
            span.events.length = 2
            return span
          },
        ],
      })
      const span = traces.startSpan('checkout')
      span.addEvent('step')
      span.end()
      await traces.flush()

      expect(sentSpans()[0].events!.map((event) => event.name)).toEqual(['step'])
    })

    it('keeps the span-side dropped count when the hook overwrites the counter', async () => {
      const traces = createTraces({
        maxEventsPerSpan: 1,
        beforeSpanSend: [
          (span) => {
            ;(span as unknown as { droppedEventsCount: unknown }).droppedEventsCount = 'lots'
            span.events.push({ name: 'audited', timestamp: Date.now() })
            return span
          },
        ],
      })
      const span = traces.startSpan('checkout')
      span.addEvent('step-0')
      span.addEvent('step-1')
      span.end()
      await traces.flush()

      // One dropped at the span, one by the post-hook re-apply.
      expect(sentSpans()[0].droppedEventsCount).toBe(2)
    })

    it('drops only the event the hook made unreadable', async () => {
      const traces = createTraces({
        beforeSpanSend: [
          (span) => {
            span.events = [span.events[0], null as never, span.events[1]]
            return span
          },
        ],
      })
      const span = traces.startSpan('checkout')
      span.addEvent('step-0')
      span.addEvent('step-1')
      span.end()
      await traces.flush()

      expect(sentSpans()[0].events!.map((event) => event.name)).toEqual(['step-0', 'step-1'])
    })

    it.each([
      ['attributes replaced with null', (span: SpanRecord) => ({ ...span, attributes: null as never })],
      ['attributes replaced with an array', (span: SpanRecord) => ({ ...span, attributes: ['a'] as never })],
      ['events replaced with null', (span: SpanRecord) => ({ ...span, events: null as never })],
      ['an async hook returning a promise', (span: SpanRecord) => Promise.resolve(span) as never],
    ])('drops the span when the hook returns %s', async (_label, beforeSpanSend) => {
      // Repairing these would export a nameless span carrying no join keys.
      const traces = createTraces({ beforeSpanSend: [beforeSpanSend] })
      traces.startSpan('checkout').end()
      await traces.flush()

      expect(sentSpans()).toHaveLength(0)
    })

    it('exports the span when the hook status message refuses to stringify', async () => {
      // The encoder downstream only marks the field, so coercing here must not
      // be the thing that costs the span.
      const traces = createTraces({
        maxAttributeValueLength: 4,
        beforeSpanSend: [
          (span) => {
            span.status = {
              code: 'error',
              message: {
                toString() {
                  throw new Error('nope')
                },
              } as never,
            }
            return span
          },
        ],
      })
      traces.startSpan('checkout').end()
      await traces.flush()

      expect(sentSpans()).toHaveLength(1)
      expect(sentSpans()[0].status?.code).toBe(2)
    })

    it('bounds a non-string status message the hook wrote', async () => {
      const traces = createTraces({
        maxAttributeValueLength: 4,
        beforeSpanSend: [
          (span) => {
            span.status = { code: 'error', message: { toString: () => 'abcdefgh' } as never }
            return span
          },
        ],
      })
      traces.startSpan('checkout').end()
      await traces.flush()

      expect(sentSpans()[0].status).toEqual({ code: 2, message: 'abcd' })
    })

    it('does not spend cap budget on a value the hook blanked', async () => {
      const traces = createTraces({
        maxAttributesPerSpan: 2,
        beforeSpanSend: [
          (span) => {
            span.attributes.secret = null
            span.attributes.scrubbed = true
            return span
          },
        ],
      })
      traces.startSpan('checkout', { attributes: { secret: 'sk-live', route: '/checkout' } }).end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.attributes!.map((attribute) => attribute.key)).toEqual(['route', 'scrubbed'])
      expect(sent.droppedAttributesCount).toBeUndefined()
    })
  })

  describe('span limits', () => {
    it('keeps the earliest attributes and counts the rest', async () => {
      const traces = createTraces({ maxAttributesPerSpan: 3 })
      const span = traces.startSpan('checkout')
      for (let i = 0; i < 5; i++) {
        span.setAttribute(`key-${i}`, i)
      }
      span.end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.attributes!.map((attribute) => attribute.key)).toEqual(['key-0', 'key-1', 'key-2'])
      expect(sent.droppedAttributesCount).toBe(2)
    })

    it('re-applies the attribute cap to what beforeSpanSend added', async () => {
      const traces = createTraces({
        maxAttributesPerSpan: 2,
        beforeSpanSend: [
          (span) => {
            for (let i = 0; i < 5; i++) {
              span.attributes[`added-${i}`] = i
            }
            return span
          },
        ],
      })
      traces.startSpan('checkout', { attributes: { kept: true } }).end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.attributes!.map((attribute) => attribute.key)).toEqual(['kept', 'added-0'])
      expect(sent.droppedAttributesCount).toBe(4)
    })

    it('re-applies the event cap to what beforeSpanSend added', async () => {
      const traces = createTraces({
        maxEventsPerSpan: 1,
        beforeSpanSend: [
          (span) => {
            span.events.push({ name: 'added', timestamp: span.startTime })
            return span
          },
        ],
      })
      const span = traces.startSpan('checkout')
      span.addEvent('original')
      span.end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.events!.map((event) => event.name)).toEqual(['original'])
      expect(sent.droppedEventsCount).toBe(1)
    })

    it('keeps the auto-context keys when beforeSpanSend pushes past the cap', async () => {
      context = { distinctId: 'alice', sessionId: 'session-1' }
      const traces = createTraces({
        maxAttributesPerSpan: 1,
        beforeSpanSend: [
          (span) => {
            span.attributes.late = true
            return span
          },
        ],
      })
      traces.startSpan('checkout', { attributes: { early: true } }).end()
      await traces.flush()

      const keys = sentSpans()[0].attributes!.map((attribute) => attribute.key)
      expect(keys).toEqual(expect.arrayContaining(['posthogDistinctId', 'sessionId', 'early']))
      expect(keys).not.toContain('late')
    })

    it('re-applies the value bound to what beforeSpanSend wrote', async () => {
      const traces = createTraces({
        maxAttributeValueLength: 8,
        beforeSpanSend: [
          (span) => {
            span.attributes.enriched = 'y'.repeat(5000)
            span.events.push({ name: 'added', timestamp: span.startTime, attributes: { blob: 'z'.repeat(5000) } })
            return span
          },
        ],
      })
      traces.startSpan('checkout').end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.attributes!.find((attribute) => attribute.key === 'enriched')!.value).toEqual({
        stringValue: 'yyyyyyyy',
      })
      expect(sent.events!.at(-1)!.attributes!.find((attribute) => attribute.key === 'blob')!.value).toEqual({
        stringValue: 'zzzzzzzz',
      })
    })

    it('does not invent a dropped count when beforeSpanSend only removes', async () => {
      const traces = createTraces({
        maxAttributesPerSpan: 5,
        beforeSpanSend: [
          (span) => {
            delete span.attributes.secret
            return span
          },
        ],
      })
      traces.startSpan('checkout', { attributes: { secret: 'x', kept: true } }).end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.attributes!.map((attribute) => attribute.key)).toEqual(['kept'])
      expect(sent.droppedAttributesCount).toBeUndefined()
    })

    it('never evicts the auto-context keys', async () => {
      context = { distinctId: 'alice', sessionId: 'session-1' }
      const traces = createTraces({ maxAttributesPerSpan: 1 })
      const span = traces.startSpan('checkout')
      for (let i = 0; i < 5; i++) {
        span.setAttribute(`key-${i}`, i)
      }
      span.end()
      await traces.flush()

      const keys = sentSpans()[0].attributes!.map((attribute) => attribute.key)
      expect(keys).toEqual(expect.arrayContaining(['posthogDistinctId', 'sessionId', 'key-0']))
      expect(keys).not.toContain('key-1')
    })

    it('caps events and counts the rest', async () => {
      const traces = createTraces({ maxEventsPerSpan: 2 })
      const span = traces.startSpan('checkout')
      for (let i = 0; i < 4; i++) {
        span.addEvent(`event-${i}`)
      }
      span.end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.events!.map((event) => event.name)).toEqual(['event-0', 'event-1'])
      expect(sent.droppedEventsCount).toBe(2)
    })

    it('lets a caller overwrite an attribute it already set while at the cap', async () => {
      const traces = createTraces({ maxAttributesPerSpan: 1 })
      const span = traces.startSpan('checkout')
      span.setAttribute('plan', 'free')
      span.setAttribute('plan', 'pro')
      span.end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.attributes).toEqual([{ key: 'plan', value: { stringValue: 'pro' } }])
      expect(sent.droppedAttributesCount).toBeUndefined()
    })

    it('omits the counters when nothing was dropped', async () => {
      const traces = createTraces()
      traces.startSpan('checkout', { attributes: { plan: 'pro' } }).end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent).not.toHaveProperty('droppedAttributesCount')
      expect(sent).not.toHaveProperty('droppedEventsCount')
    })

    it('counts a parsed __proto__ key against the cap instead of smuggling it through', async () => {
      // JSON.parse produces an own `__proto__` key; a plain object store would
      // swap its prototype and leak every nested key past the cap.
      const traces = createTraces({ maxAttributesPerSpan: 2 })
      const parsed = JSON.parse('{"__proto__": {"leaked": 1}, "orderId": "abc"}')
      traces.startSpan('checkout', { attributes: parsed }).end()
      await traces.flush()

      const keys = sentSpans()[0].attributes!.map((attribute) => attribute.key)
      expect(keys).not.toContain('leaked')
      expect(keys).toContain('orderId')
    })

    it('does not let reserved property names bypass the cap', async () => {
      const traces = createTraces({ maxAttributesPerSpan: 1 })
      const span = traces.startSpan('checkout')
      span.setAttribute('kept', 1)
      span.setAttribute('toString', 'nope')
      span.setAttribute('constructor', 'nope')
      span.end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.attributes!.map((attribute) => attribute.key)).toEqual(['kept'])
      expect(sent.droppedAttributesCount).toBe(2)
    })

    it('does not spend cap budget on values that are dropped at encode time', async () => {
      const traces = createTraces({ maxAttributesPerSpan: 2 })
      const span = traces.startSpan('checkout')
      span.setAttribute('skipped-a', undefined)
      span.setAttribute('skipped-b', null)
      span.setAttribute('orderId', 'abc-123')
      span.end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.attributes!.map((attribute) => attribute.key)).toEqual(['orderId'])
      expect(sent.droppedAttributesCount).toBeUndefined()
    })

    it('still caps a key first seen with an optional value', async () => {
      const traces = createTraces({ maxAttributesPerSpan: 2 })
      const span = traces.startSpan('checkout')
      for (let i = 0; i < 5; i++) {
        span.setAttribute(`field-${i}`, undefined)
      }
      for (let i = 0; i < 5; i++) {
        span.setAttribute(`field-${i}`, i)
      }
      span.end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.attributes).toHaveLength(2)
      expect(sent.droppedAttributesCount).toBe(3)
    })

    it('clears a key that is set back to null', async () => {
      const traces = createTraces({ maxAttributesPerSpan: 2 })
      const span = traces.startSpan('checkout')
      span.setAttribute('orderId', 'abc-123')
      span.setAttribute('orderId', null)
      span.setAttribute('a', 1)
      span.setAttribute('b', 2)
      span.end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.attributes!.map((attribute) => attribute.key)).toEqual(['a', 'b'])
      expect(sent.droppedAttributesCount).toBeUndefined()
    })

    it('caps attributes supplied at start', async () => {
      const traces = createTraces({ maxAttributesPerSpan: 2 })
      traces.startSpan('checkout', { attributes: { a: 1, b: 2, c: 3 } }).end()
      await traces.flush()

      const [sent] = sentSpans()
      expect(sent.attributes!.map((attribute) => attribute.key)).toEqual(['a', 'b'])
      expect(sent.droppedAttributesCount).toBe(1)
    })
  })

  describe('export', () => {
    it('flushes when the queue reaches the batch size', async () => {
      const traces = createTraces({ maxExportBatchSize: 2 })
      traces.startSpan('a').end()
      expect(mockInstance._sendTracesBatch).not.toHaveBeenCalled()

      traces.startSpan('b').end()
      await flushMicrotasks()

      expect(sentSpans()).toHaveLength(2)
    })

    it('does not re-post on every span end while a flush is failing', async () => {
      mockInstance._sendTracesBatch.mockResolvedValue({ kind: 'retry-later', error: new Error('down') })
      const traces = createTraces({ maxExportBatchSize: 2, maxQueueSize: 10 })
      for (let i = 0; i < 10; i++) {
        traces.startSpan(`span-${i}`).end()
        await flushMicrotasks()
      }

      expect(mockInstance._sendTracesBatch).toHaveBeenCalledTimes(1)
    })

    it('flushes on the interval timer', async () => {
      const traces = createTraces({ flushIntervalMs: 1000 })
      traces.startSpan('a').end()
      expect(mockInstance._sendTracesBatch).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1000)
      expect(sentSpans()).toHaveLength(1)
    })

    it('sends one resource and one scope per batch', async () => {
      const traces = createTraces({ serviceName: 'checkout-api' })
      traces.startSpan('a').end()
      traces.startSpan('b').end()
      await traces.flush()

      const [payload] = sentPayloads()
      expect(payload.resourceSpans).toHaveLength(1)
      expect(payload.resourceSpans[0].scopeSpans).toHaveLength(1)
      expect(payload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2)
      expect(payload.resourceSpans[0].resource.attributes).toContainEqual({
        key: 'service.name',
        value: { stringValue: 'checkout-api' },
      })
    })

    it('splits a backlog across batches', async () => {
      const traces = createTraces({ maxExportBatchSize: 2 })
      for (let i = 0; i < 5; i++) {
        traces.startSpan(`span-${i}`).end()
      }
      await traces.flush()

      expect(sentPayloads().length).toBeGreaterThanOrEqual(3)
      expect(sentSpans()).toHaveLength(5)
    })

    it('joins an in-flight flush rather than double-sending', async () => {
      const traces = createTraces()
      traces.startSpan('a').end()

      const [first, second] = [traces.flush(), traces.flush()]
      await Promise.all([first, second])

      expect(mockInstance._sendTracesBatch).toHaveBeenCalledTimes(1)
      expect(sentSpans()).toHaveLength(1)
    })

    it('drops the incoming span when the queue is full, keeping queued parents', async () => {
      // Queued spans are completed parents whose children may already have been
      // exported; evicting them would break assembled traces retroactively.
      const traces = createTraces({ maxQueueSize: 2, maxExportBatchSize: 100 })
      traces.startSpan('first').end()
      traces.startSpan('second').end()
      traces.startSpan('third').end()
      await traces.flush()

      expect(sentSpans().map((s) => s.name)).toEqual(['first', 'second'])
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the queue is full'))
    })
  })

  describe('export failures', () => {
    it('halves the batch and resends the same spans on 413', async () => {
      const outcomes: SendTracesBatchOutcome[] = [{ kind: 'too-large' }, { kind: 'ok' }, { kind: 'ok' }]
      const instance = createMockInstance({
        _sendTracesBatch: vi.fn(() => Promise.resolve(outcomes.shift() ?? { kind: 'ok' })),
      })
      const traces = createTraces({ maxExportBatchSize: 4 }, instance)
      for (let i = 0; i < 4; i++) {
        traces.startSpan(`span-${i}`).end()
      }
      await traces.flush()

      const batchSizes = sentPayloads(instance).map((p) => p.resourceSpans[0].scopeSpans[0].spans.length)
      expect(batchSizes).toEqual([4, 2, 2])
      expect(sentSpans(instance)).toHaveLength(8)
    })

    it('shrinks below the queue depth on 413 rather than resending the same body', async () => {
      // The batch the server rejected is what has to get smaller. Halving the
      // configured maximum leaves `size` unchanged whenever the queue is
      // shallower than it — the ordinary timer-flush case.
      const instance = createMockInstance({
        _sendTracesBatch: vi.fn().mockResolvedValueOnce({ kind: 'too-large' }).mockResolvedValue({ kind: 'ok' }),
      })
      const traces = createTraces({ maxExportBatchSize: 512 }, instance)
      for (let i = 0; i < 3; i++) {
        traces.startSpan(`span-${i}`).end()
      }
      await traces.flush()

      const batchSizes = sentPayloads(instance).map((p) => p.resourceSpans[0].scopeSpans[0].spans.length)
      expect(batchSizes).toEqual([3, 1, 2])
    })

    it('ramps the batch size back up after a 413 shrink', async () => {
      // A one-off oversized payload shouldn't permanently halve throughput.
      const instance = createMockInstance({
        _sendTracesBatch: vi.fn().mockResolvedValueOnce({ kind: 'too-large' }).mockResolvedValue({ kind: 'ok' }),
      })
      const traces = createTraces({ maxExportBatchSize: 4 }, instance)
      for (let i = 0; i < 4; i++) {
        traces.startSpan(`span-${i}`).end()
      }
      await traces.flush()

      // Shrunk to 2, then +1 per healthy send across the two batches that drained it.
      instance._sendTracesBatch.mockClear()
      for (let i = 0; i < 4; i++) {
        traces.startSpan(`later-${i}`).end()
      }
      await traces.flush()

      expect(sentPayloads(instance)[0].resourceSpans[0].scopeSpans[0].spans.length).toBeGreaterThan(2)
    })

    it('drops a single span the server rejects as too large', async () => {
      const instance = createMockInstance({
        _sendTracesBatch: vi.fn(() => Promise.resolve({ kind: 'too-large' as const })),
      })
      const traces = createTraces({ maxExportBatchSize: 1 }, instance)
      traces.startSpan('huge').end()
      await traces.flush()

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('too large'))

      // The span must actually leave the queue, or it is re-POSTed on every
      // flush for the life of the process.
      instance._sendTracesBatch.mockResolvedValue({ kind: 'ok' })
      traces.startSpan('later').end()
      await traces.flush()
      expect(sentSpans(instance).map((s) => s.name)).toEqual(['huge', 'later'])
    })

    it('names the reason for each kind of drop', async () => {
      const instance = createMockInstance({
        _sendTracesBatch: vi.fn(() => Promise.resolve({ kind: 'fatal' as const, error: new Error('400') })),
      })
      const traces = createTraces({ maxExportBatchSize: 1 }, instance)
      traces.startSpan('poison').end()
      await traces.flush()

      // A poison batch is not a full queue; telling an operator to reduce span
      // volume would send them after the wrong problem.
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('rejected the batch'))
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('queue is full'))
    })

    it('warns again about drops on a later flush', async () => {
      // Warning once per process would leave the SDK silent about every
      // subsequent drop for the life of the app.
      const instance = createMockInstance({
        _sendTracesBatch: vi.fn(() => Promise.resolve({ kind: 'fatal' as const, error: new Error('400') })),
      })
      const traces = createTraces({ maxExportBatchSize: 1 }, instance)

      traces.startSpan('a').end()
      await traces.flush()
      traces.startSpan('b').end()
      await traces.flush()

      expect((logger.warn as vi.Mock).mock.calls.length).toBeGreaterThan(1)
    })

    it('keeps spans queued on a retriable failure', async () => {
      const instance = createMockInstance({
        _sendTracesBatch: vi
          .fn()
          .mockResolvedValueOnce({ kind: 'retry-later', error: new Error('network') })
          .mockResolvedValue({ kind: 'ok' }),
      })
      const traces = createTraces({}, instance)
      traces.startSpan('a').end()

      await traces.flush()
      expect(sentSpans(instance)).toHaveLength(1)

      await traces.flush()
      expect(sentSpans(instance)).toHaveLength(2)
      expect(sentSpans(instance)[1].name).toBe('a')
    })

    it('backs off exponentially while sends keep failing', async () => {
      const instance = createMockInstance({
        _sendTracesBatch: vi.fn(() => Promise.resolve({ kind: 'retry-later' as const, error: new Error('network') })),
      })
      const traces = createTraces({ flushIntervalMs: 5000 }, instance)
      traces.startSpan('a').end()

      const sendsPerWindow: number[] = []
      for (let i = 0; i < 8; i++) {
        await vi.advanceTimersByTimeAsync(5000)
        sendsPerWindow.push(instance._sendTracesBatch.mock.calls.length)
      }

      expect(sendsPerWindow).toEqual([1, 2, 2, 3, 3, 3, 3, 4])
    })

    it('returns to the base interval after a send succeeds', async () => {
      const instance = createMockInstance({
        _sendTracesBatch: vi
          .fn()
          .mockResolvedValueOnce({ kind: 'retry-later', error: new Error('network') })
          .mockResolvedValueOnce({ kind: 'retry-later', error: new Error('network') })
          .mockResolvedValue({ kind: 'ok' }),
      })
      const traces = createTraces({ flushIntervalMs: 5000 }, instance)
      traces.startSpan('a').end()

      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(10000)
      expect(instance._sendTracesBatch).toHaveBeenCalledTimes(3)

      traces.startSpan('b').end()
      await vi.advanceTimersByTimeAsync(5000)
      expect(instance._sendTracesBatch).toHaveBeenCalledTimes(4)
    })

    it('drops a poison batch rather than wedging the queue', async () => {
      const instance = createMockInstance({
        _sendTracesBatch: vi
          .fn()
          .mockResolvedValueOnce({ kind: 'fatal', error: new Error('400') })
          .mockResolvedValue({ kind: 'ok' }),
      })
      const traces = createTraces({ maxExportBatchSize: 1 }, instance)
      traces.startSpan('poison').end()
      traces.startSpan('good').end()
      await traces.flush()

      expect(sentSpans(instance).map((s) => s.name)).toEqual(['poison', 'good'])

      instance._sendTracesBatch.mockClear()
      await traces.flush()
      expect(instance._sendTracesBatch).not.toHaveBeenCalled()
    })

    it('does not surface a transport failure through span.end()', async () => {
      // Ending a span is application control flow — it must never throw because
      // the exporter is broken.
      const instance = createMockInstance({
        _sendTracesBatch: vi.fn(() => Promise.reject(new Error('transport exploded'))),
      })
      const traces = createTraces({ maxExportBatchSize: 1 }, instance)

      expect(() => traces.startSpan('a').end()).not.toThrow()
      // Let the background flush settle; the rejection is swallowed there.
      await vi.advanceTimersByTimeAsync(0)
    })

    it('surfaces a transport failure through an explicit flush()', async () => {
      // flush() is the caller asking to be told, so it propagates — matching
      // how the logs and metrics pipelines behave.
      const instance = createMockInstance({
        _sendTracesBatch: vi.fn(() => Promise.reject(new Error('transport exploded'))),
      })
      const traces = createTraces({ maxExportBatchSize: 100 }, instance)
      traces.startSpan('a').end()

      await expect(traces.flush()).rejects.toThrow('transport exploded')
    })
  })

  describe('poison attributes', () => {
    it('encodes a circular attribute instead of blowing the stack', async () => {
      const traces = createTraces()
      const cyclic: any = { name: 'order' }
      cyclic.self = cyclic

      traces.startSpan('checkout', { attributes: { payload: cyclic } }).end()
      await traces.flush()

      expect(sentSpans()).toHaveLength(1)
      expect(JSON.stringify(sentPayloads()[0])).toContain('[Circular]')
    })

    it('treats a repeated sibling reference as duplication, not a cycle', async () => {
      const traces = createTraces()
      const shared = { id: 1 }

      traces.startSpan('checkout', { attributes: { a: shared, b: shared } as any }).end()
      await traces.flush()

      expect(JSON.stringify(sentPayloads()[0])).not.toContain('[Circular]')
    })

    it('keeps a span whose attribute getter throws, marking only that key', async () => {
      // The shared encoder contains a throwing getter at the key it belongs to,
      // so the span keeps its name, timing and every other attribute instead of
      // being dropped whole.
      const traces = createTraces({ maxExportBatchSize: 1 })
      const exploding = {
        ok: 1,
        get boom() {
          throw new Error('getter exploded')
        },
      }

      traces.startSpan('poison', { attributes: { payload: exploding as any } }).end()
      traces.startSpan('healthy').end()
      await traces.flush()

      expect(sentSpans().map((s) => s.name)).toEqual(['poison', 'healthy'])
      expect(JSON.stringify(sentPayloads()[0])).toContain('[Unserializable]')
      expect(JSON.stringify(sentPayloads()[0])).toContain('"intValue":"1"')
    })

    it('keeps a span whose top-level attribute getter throws, marking only that key', async () => {
      const traces = createTraces({ maxExportBatchSize: 1 })
      const attributes: any = { ok: 1 }
      Object.defineProperty(attributes, 'boom', {
        enumerable: true,
        get() {
          throw new Error('getter exploded')
        },
      })

      expect(() => traces.startSpan('poison', { attributes }).end()).not.toThrow()
      await traces.flush()

      expect(sentSpans().map((s) => s.name)).toEqual(['poison'])
      expect(JSON.stringify(sentPayloads()[0])).toContain('[Unserializable]')
      expect(JSON.stringify(sentPayloads()[0])).toContain('"intValue":"1"')
    })
  })

  describe('consent withdrawn after a span is queued', () => {
    it('does not export spans queued before optOut()', async () => {
      const instance = createMockInstance()
      const traces = createTraces({}, instance)
      context = { distinctId: 'alice', sessionId: 'session-1' }
      traces.startSpan('checkout').end()

      instance.optedOut = true
      await traces.flush()

      expect(instance._sendTracesBatch).not.toHaveBeenCalled()
    })

    it('does not export spans queued before the client is disabled', async () => {
      const instance = createMockInstance()
      const traces = createTraces({}, instance)
      traces.startSpan('checkout').end()

      instance.isDisabled = true
      await traces.flush()

      expect(instance._sendTracesBatch).not.toHaveBeenCalled()
    })

    it('counts spans discarded from the queue when consent is withdrawn', async () => {
      const instance = createMockInstance()
      const traces = createTraces({}, instance)
      traces.startSpan('a').end()
      traces.startSpan('b').end()

      instance.optedOut = true
      await traces.flush()

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('2 span(s)'))
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the user has opted out'))
    })
  })

  describe('drop accounting', () => {
    it('still warns about queue-full drops while the endpoint is failing', async () => {
      mockInstance._sendTracesBatch.mockResolvedValue({ kind: 'retry-later', error: new Error('down') })
      const traces = createTraces({ maxExportBatchSize: 2, maxQueueSize: 2 })
      for (let i = 0; i < 10; i++) {
        traces.startSpan(`span-${i}`).end()
        await flushMicrotasks()
      }

      const warnings = logger.warn.mock.calls.map((call: any[]) => call[0])
      expect(warnings.join(' ')).toContain('queue is full')
    })

    it('rate-limits the warning instead of one per dropped span', async () => {
      mockInstance._sendTracesBatch.mockResolvedValue({ kind: 'retry-later', error: new Error('down') })
      const traces = createTraces({ maxExportBatchSize: 2, maxQueueSize: 2, flushIntervalMs: 10_000 })
      for (let i = 0; i < 30; i++) {
        traces.startSpan(`span-${i}`).end()
        await flushMicrotasks()
      }

      expect(logger.warn.mock.calls.length).toBeLessThanOrEqual(2)
    })

    it('surfaces queue-full drops even when every flush pass exits early', async () => {
      // The retriable branch returns before the drain loop ends, so only the
      // pass-level `finally` can emit this warning.
      mockInstance._sendTracesBatch.mockResolvedValue({ kind: 'retry-later', error: new Error('down') })
      const traces = createTraces({ maxExportBatchSize: 2, maxQueueSize: 2, flushIntervalMs: 1000 })
      traces.startSpan('queued-a').end()
      traces.startSpan('queued-b').end()
      await flushMicrotasks()

      // The first drop opens the rate-limit window itself.
      traces.startSpan('dropped-first').end()
      await flushMicrotasks()
      logger.warn.mockClear()

      // The second lands inside that window, so `_recordDrop` stays quiet and
      // only the flush pass's own `finally` can report it.
      traces.startSpan('dropped-second').end()
      await flushMicrotasks()
      expect(logger.warn).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1000)

      expect(logger.warn.mock.calls.map((call: any[]) => call[0]).join(' ')).toContain('queue is full')
    })

    it('warns again once the flush interval has passed', async () => {
      mockInstance._sendTracesBatch.mockResolvedValue({ kind: 'retry-later', error: new Error('down') })
      const traces = createTraces({ maxExportBatchSize: 2, maxQueueSize: 2, flushIntervalMs: 1000 })
      for (let i = 0; i < 4; i++) {
        traces.startSpan(`first-${i}`).end()
        await flushMicrotasks()
      }
      const afterFirstWindow = logger.warn.mock.calls.length

      await vi.advanceTimersByTimeAsync(1000)
      traces.startSpan('later').end()
      await flushMicrotasks()

      expect(afterFirstWindow).toBe(1)
      expect(logger.warn.mock.calls.length).toBeGreaterThan(afterFirstWindow)
    })

    it('warns once per flush with the total, not the first drop', async () => {
      mockInstance._sendTracesBatch.mockResolvedValue({ kind: 'fatal', error: new Error('bad key') })
      const traces = createTraces({ maxExportBatchSize: 5, maxQueueSize: 5 })
      traces.startSpan('a').end()
      traces.startSpan('b').end()
      traces.startSpan('c').end()
      await traces.flush()

      const warnings = logger.warn.mock.calls.map((call: any[]) => call[0])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('3 span(s)')
      expect(warnings[0]).toContain('rejected the batch')
    })
  })

  describe('hostile input', () => {
    it('still exports when a resourceAttributes accessor throws', async () => {
      const hostile: Record<string, unknown> = {}
      Object.defineProperty(hostile, 'host.name', {
        enumerable: true,
        get() {
          throw new Error('accessor exploded')
        },
      })
      // This runs before the flush pass's own error handling, so an unguarded
      // read would rethrow on every flush and export nothing, ever.
      const traces = createTraces({ resourceAttributes: hostile as never })
      traces.startSpan('checkout').end()
      await traces.flush()

      expect(sentSpans().map((span) => span.name)).toEqual(['checkout'])
    })

    it('bounds a long resource attribute value', async () => {
      // Resource attributes are caller-supplied like span attributes, and they
      // ride on every batch rather than on one span.
      const traces = createTraces({
        maxAttributeValueLength: 4,
        resourceAttributes: { 'host.name': 'abcdefgh' } as never,
      })
      traces.startSpan('checkout').end()
      await traces.flush()

      const resource = sentPayloads()[0].resourceSpans[0].resource!.attributes
      expect(resource.find((attribute) => attribute.key === 'host.name')?.value).toEqual({ stringValue: 'abcd' })
    })

    it('does not throw on a Date-like object with no Date slot', () => {
      const traces = createTraces()
      const fakeDate = Object.create(Date.prototype)

      expect(() => traces.startSpan('checkout', { startTime: fakeDate }).end(fakeDate)).not.toThrow()
    })

    it('does not throw when the parent has a throwing accessor', () => {
      const traces = createTraces()
      const hostile = {
        get traceparent() {
          throw new Error('accessor exploded')
        },
      }

      expect(() => traces.startSpan('checkout', { parent: hostile as any })).not.toThrow()
    })
  })

  describe('background flush triggers', () => {
    it('runs one background drain at a time while the queue stays saturated', async () => {
      const traces = createTraces({ maxExportBatchSize: 8, maxQueueSize: 64 })
      let live = 0
      let peak = 0
      const drain = traces.flush.bind(traces)
      vi.spyOn(traces, 'flush').mockImplementation(() => {
        live++
        peak = Math.max(peak, live)
        return drain().finally(() => {
          live--
        })
      })

      for (let i = 0; i < 500; i++) {
        traces.startSpan(`span-${i}`).end()
        if (i % 50 === 0) {
          await flushMicrotasks()
        }
      }

      // A drain per span end would stack a loop per span, each retaining frames.
      expect(peak).toBeLessThanOrEqual(2)
    })
  })

  describe('background flush re-arming', () => {
    it('leaves a timer behind for a span that ends as a drain finishes', async () => {
      const traces = createTraces({ maxExportBatchSize: 1, flushIntervalMs: 5000 })
      traces.startSpan('a').end()
      // Four microtasks in: the drain has returned but its finally has not run,
      // so the dedupe guard is still set and the queue was empty when it armed.
      let chain: Promise<void> = Promise.resolve()
      for (let hop = 0; hop < 4; hop++) {
        chain = chain.then(() => undefined)
      }
      await chain.then(() => {
        traces.startSpan('b').end()
      })
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(5000)

      expect(sentSpans().map((span) => span.name)).toEqual(['a', 'b'])
    })
  })

  describe('retry backoff', () => {
    it('caps the retry delay while the endpoint keeps failing', async () => {
      mockInstance._sendTracesBatch.mockResolvedValue({ kind: 'retry-later', error: new Error('down') })
      const traces = createTraces({ flushIntervalMs: 1000, maxExportBatchSize: 1 })
      traces.startSpan('a').end()

      const delays: number[] = []
      // Seven retries: the eighth spends the batch's retry budget and drops it.
      for (let attempt = 0; attempt < 7; attempt++) {
        const before = mockInstance._sendTracesBatch.mock.calls.length
        let waited = 0
        while (mockInstance._sendTracesBatch.mock.calls.length === before && waited < 120_000) {
          await vi.advanceTimersByTimeAsync(1000)
          waited += 1000
        }
        delays.push(waited)
      }

      expect(Math.max(...delays)).toBeLessThanOrEqual(30_000)
      expect(delays.slice(-2)).toEqual([30_000, 30_000])
    })
  })

  describe('retry budget', () => {
    it('drops a batch the endpoint keeps refusing and moves to the next one', async () => {
      mockInstance._sendTracesBatch.mockResolvedValue({ kind: 'retry-later', error: new Error('down') })
      const traces = createTraces({ flushIntervalMs: 1000, maxExportBatchSize: 1 })
      traces.startSpan('stuck').end()
      traces.startSpan('fresher').end()

      // Eight retriable failures spend the head batch's budget.
      for (let attempt = 0; attempt < 12; attempt++) {
        await vi.advanceTimersByTimeAsync(30_000)
      }

      const attempted = mockInstance._sendTracesBatch.mock.calls.flatMap((call: any[]) =>
        call[0].resourceSpans[0].scopeSpans[0].spans.map((span: OtlpSpan) => span.name)
      )
      // The stuck span is given up on, and the one behind it gets its turn.
      expect(attempted).toContain('fresher')
      expect(logger.warn.mock.calls.map((call: any[]) => call[0]).join(' ')).toContain('8 times in a row')
    })

    it('does not charge fresh spans to a budget they never spent', async () => {
      mockInstance._sendTracesBatch.mockResolvedValue({ kind: 'retry-later', error: new Error('down') })
      const traces = createTraces({ flushIntervalMs: 1000, maxExportBatchSize: 512, maxQueueSize: 2048 })
      traces.startSpan('old').end()
      while (mockInstance._sendTracesBatch.mock.calls.length < 7) {
        await vi.advanceTimersByTimeAsync(30_000)
      }
      for (let i = 0; i < 20; i++) {
        traces.startSpan(`fresh-${i}`).end()
      }
      await vi.advanceTimersByTimeAsync(30_000)

      const eighth = mockInstance._sendTracesBatch.mock.calls[7][0] as OtlpTracesPayload
      // The head cannot grow to sweep in spans that have never been retried.
      expect(eighth.resourceSpans[0].scopeSpans[0].spans.map((span) => span.name)).toEqual(['old'])
    })

    it('gives the halved batch its own budget after a 413', async () => {
      let attempt = 0
      const attempted: string[][] = []
      mockInstance._sendTracesBatch.mockImplementation(async (payload: OtlpTracesPayload) => {
        attempted.push(payload.resourceSpans[0].scopeSpans[0].spans.map((span) => span.name))
        attempt++
        if (attempt <= 7) {
          return { kind: 'retry-later', error: new Error('down') }
        }
        // The 413 replaces the head batch, so its failure count must not carry over.
        return attempt === 8 ? { kind: 'too-large' } : { kind: 'retry-later', error: new Error('down') }
      })
      const traces = createTraces({ flushIntervalMs: 1000, maxExportBatchSize: 4, maxQueueSize: 32 })
      for (let i = 0; i < 8; i++) {
        traces.startSpan(`s${i}`).end()
      }
      for (let tick = 0; tick < 6; tick++) {
        await vi.advanceTimersByTimeAsync(30_000)
      }

      const halved = attempted.filter((names) => names.join() === 's0,s1')
      expect(halved.length).toBeGreaterThan(1)
      expect(logger.warn).not.toHaveBeenCalled()
    })

    it('gives a later batch its full budget after a success', async () => {
      let attempt = 0
      // Four failures, a success, then four more: seven consecutive failures
      // would spend the budget, but the success in between must reset it.
      const succeedsOn = [5, 10]
      mockInstance._sendTracesBatch.mockImplementation(async () => {
        attempt++
        return succeedsOn.includes(attempt) ? { kind: 'ok' } : { kind: 'retry-later', error: new Error('blip') }
      })
      const traces = createTraces({ flushIntervalMs: 1000, maxExportBatchSize: 1 })
      traces.startSpan('a').end()
      traces.startSpan('b').end()
      for (let tick = 0; tick < 12; tick++) {
        await vi.advanceTimersByTimeAsync(30_000)
      }

      expect([...new Set(sentSpans().map((span) => span.name))]).toEqual(['a', 'b'])
      expect(logger.warn).not.toHaveBeenCalled()
    })
  })

  describe('drain progress', () => {
    it('drains a span that arrives while a send is in flight', async () => {
      // Queue length can't measure progress: one span out and one in leaves it
      // unchanged, which would read as "no progress" and strand the new span —
      // and shutdown() then discards it.
      let onSend = (): void => {}
      const instance = createMockInstance({
        _sendTracesBatch: vi.fn(() => {
          onSend()
          onSend = (): void => {}
          return Promise.resolve({ kind: 'ok' as const })
        }),
      })
      const traces = createTraces({ maxExportBatchSize: 10 }, instance)
      onSend = (): void => traces.startSpan('arrived-mid-flight').end()

      traces.startSpan('first').end()
      await traces.flush()

      expect(sentSpans(instance).map((s) => s.name)).toEqual(['first', 'arrived-mid-flight'])
    })

    it('terminates rather than spinning when a batch size of zero slips through', async () => {
      // Core must not depend on every host clamping its config.
      const traces = createTraces({ maxExportBatchSize: 0 })
      traces.startSpan('a').end()

      await traces.flush()

      expect(sentSpans()).toHaveLength(1)
    })
  })

  describe('live span bounds', () => {
    it('returns an inert handle once maxLiveSpans spans are live', async () => {
      const traces = createTraces({ maxLiveSpans: 2 })

      traces.startSpan('live-a')
      traces.startSpan('live-b')
      const refused = traces.startSpan('refused')
      refused.end()
      await traces.flush()

      expect(sentSpans()).toHaveLength(0)
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the live-span limit (2) was reached'))
    })

    it('frees the slot when a span ends', async () => {
      const traces = createTraces({ maxLiveSpans: 1 })

      traces.startSpan('first').end()
      traces.startSpan('second').end()
      await traces.flush()

      expect(sentSpans().map((s) => s.name)).toEqual(['first', 'second'])
    })

    it('never exports a span evicted for exceeding maxSpanAgeMs', async () => {
      const traces = createTraces({ maxSpanAgeMs: 60_000 })
      const leaked = traces.startSpan('leaked')

      await vi.advanceTimersByTimeAsync(61_000)
      // Eviction is lazy: the next startSpan sweeps.
      traces.startSpan('later').end()
      leaked.end()
      await traces.flush()

      expect(sentSpans().map((s) => s.name)).toEqual(['later'])
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('still live after 60000ms'))
    })

    it('returns the slot on age eviction so a leak cannot disable tracing', async () => {
      const traces = createTraces({ maxLiveSpans: 1, maxSpanAgeMs: 60_000 })
      traces.startSpan('leaked-forever')

      await vi.advanceTimersByTimeAsync(61_000)
      traces.startSpan('after-the-leak').end()
      await traces.flush()

      expect(sentSpans().map((s) => s.name)).toEqual(['after-the-leak'])
    })

    it('ages from startSpan, not from a caller-supplied startTime', async () => {
      const traces = createTraces({ maxSpanAgeMs: 60_000 })
      // Backdated an hour: aging off the supplied time would evict it immediately.
      const backdated = traces.startSpan('backdated', { startTime: Date.now() - 3_600_000 })

      traces.startSpan('sweep-trigger').end()
      backdated.end()
      await traces.flush()

      expect(sentSpans().map((s) => s.name)).toEqual(['sweep-trigger', 'backdated'])
    })
  })

  describe('reset', () => {
    it('abandons an in-flight pass instead of splicing spans it never sent', async () => {
      let release!: (outcome: SendTracesBatchOutcome) => void
      const instance = createMockInstance({
        _sendTracesBatch: vi.fn(
          () =>
            new Promise<SendTracesBatchOutcome>((resolve) => {
              release = resolve
            })
        ),
      })
      const traces = createTraces({ maxExportBatchSize: 10 }, instance)

      traces.startSpan('sent-a').end()
      traces.startSpan('sent-b').end()
      const inFlight = traces.flush()
      await Promise.resolve()

      // shutdown() lost the race and tore the pipeline down.
      traces.reset()
      traces.startSpan('after-reset').end()

      release({ kind: 'ok' })
      await inFlight

      expect((traces as any)._queue.map((r: any) => r.name)).toEqual(['after-reset'])
    })

    it('clears the queue', async () => {
      const traces = createTraces()
      traces.startSpan('a').end()
      traces.reset()
      await traces.flush()

      expect(mockInstance._sendTracesBatch).not.toHaveBeenCalled()
    })
  })
})
