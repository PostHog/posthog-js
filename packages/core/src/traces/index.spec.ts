import { PostHogTraces } from './index'
import { SyncSpanContextManager } from './context'
import { NOOP_SPAN } from './span'
import type {
  OtlpSpan,
  OtlpTracesPayload,
  ResolvedTracesConfig,
  SendTracesBatchOutcome,
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
  maxAttributesPerSpan: 128,
  maxEventsPerSpan: 128,
  ...partial,
})

const createMockInstance = (overrides: Record<string, any> = {}): any => ({
  isDisabled: false,
  optedOut: false,
  getLibraryId: jest.fn(() => 'posthog-core-tests'),
  getLibraryVersion: jest.fn(() => '0.0.0-test'),
  _sendTracesBatch: jest.fn((): Promise<SendTracesBatchOutcome> => Promise.resolve({ kind: 'ok' })),
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
      await jest.advanceTimersByTimeAsync(80)
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
      const fn = jest.fn(() => 'value')

      expect(traces.withSpan('job', fn)).toBe('value')
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith(NOOP_SPAN)
      expect(traces.getActiveSpan()).toBeNull()
      await traces.flush()
      expect(sentSpans()).toHaveLength(0)
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
      // These attribute names are a wire contract the browser and mobile hosts
      // will encode against; renaming one silently breaks the join.
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
      await traces.flush()
      expect(sentSpans()).toHaveLength(2)
    })

    it('flushes on the interval timer', async () => {
      const traces = createTraces({ flushIntervalMs: 1000 })
      traces.startSpan('a').end()
      expect(mockInstance._sendTracesBatch).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(1000)
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
        _sendTracesBatch: jest.fn(() => Promise.resolve(outcomes.shift() ?? { kind: 'ok' })),
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
        _sendTracesBatch: jest.fn().mockResolvedValueOnce({ kind: 'too-large' }).mockResolvedValue({ kind: 'ok' }),
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
        _sendTracesBatch: jest.fn().mockResolvedValueOnce({ kind: 'too-large' }).mockResolvedValue({ kind: 'ok' }),
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
        _sendTracesBatch: jest.fn(() => Promise.resolve({ kind: 'too-large' as const })),
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
        _sendTracesBatch: jest.fn(() => Promise.resolve({ kind: 'fatal' as const, error: new Error('400') })),
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
        _sendTracesBatch: jest.fn(() => Promise.resolve({ kind: 'fatal' as const, error: new Error('400') })),
      })
      const traces = createTraces({ maxExportBatchSize: 1 }, instance)

      traces.startSpan('a').end()
      await traces.flush()
      traces.startSpan('b').end()
      await traces.flush()

      expect((logger.warn as jest.Mock).mock.calls.length).toBeGreaterThan(1)
    })

    it('keeps spans queued on a retriable failure', async () => {
      const instance = createMockInstance({
        _sendTracesBatch: jest
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

    it('drops a poison batch rather than wedging the queue', async () => {
      const instance = createMockInstance({
        _sendTracesBatch: jest
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
        _sendTracesBatch: jest.fn(() => Promise.reject(new Error('transport exploded'))),
      })
      const traces = createTraces({ maxExportBatchSize: 1 }, instance)

      expect(() => traces.startSpan('a').end()).not.toThrow()
      // Let the background flush settle; the rejection is swallowed there.
      await jest.advanceTimersByTimeAsync(0)
    })

    it('surfaces a transport failure through an explicit flush()', async () => {
      // flush() is the caller asking to be told, so it propagates — matching
      // how the logs and metrics pipelines behave.
      const instance = createMockInstance({
        _sendTracesBatch: jest.fn(() => Promise.reject(new Error('transport exploded'))),
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
  })

  describe('drain progress', () => {
    it('drains a span that arrives while a send is in flight', async () => {
      // Queue length can't measure progress: one span out and one in leaves it
      // unchanged, which would read as "no progress" and strand the new span —
      // and shutdown() then discards it.
      let onSend = (): void => {}
      const instance = createMockInstance({
        _sendTracesBatch: jest.fn(() => {
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

  describe('reset', () => {
    it('abandons an in-flight pass instead of splicing spans it never sent', async () => {
      let release!: (outcome: SendTracesBatchOutcome) => void
      const instance = createMockInstance({
        _sendTracesBatch: jest.fn(
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
