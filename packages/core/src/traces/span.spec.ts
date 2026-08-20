import { NOOP_SPAN, PostHogSpan, describeError } from './span'
import type { SpanInit } from './span'
import type { SpanRecord } from './types'
import type { Logger } from '../types'
import { createMockLogger } from '@/testing'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

describe('PostHogSpan', () => {
  let ended: SpanRecord[]
  let logger: Logger

  const createSpan = (init: Partial<SpanInit> = {}): PostHogSpan =>
    new PostHogSpan(
      {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        name: 'checkout',
        kind: 'internal',
        attributes: {},
        startTime: Date.now(),
        backdated: false,
        autoAttributeKeys: [],
        maxAttributes: 128,
        maxEvents: 128,
        ...init,
      },
      (record) => ended.push(record),
      logger
    )

  beforeEach(() => {
    ended = []
    logger = createMockLogger()
  })

  it('produces exactly one record on end', () => {
    createSpan().end()
    expect(ended).toHaveLength(1)
    expect(ended[0].name).toBe('checkout')
  })

  it('is idempotent on end', () => {
    const span = createSpan()
    span.end()
    span.end()
    expect(ended).toHaveLength(1)
  })

  it('ignores operations after end', () => {
    const span = createSpan()
    span.end()
    span.setAttribute('k', 'v')
    span.updateName('renamed')
    span.addEvent('late')

    expect(ended[0].attributes).not.toHaveProperty('k')
    expect(ended[0].name).toBe('checkout')
    expect(ended[0].events).toHaveLength(0)
  })

  it('chains mutators', () => {
    const span = createSpan()
    span.setAttribute('a', 1).setAttributes({ b: 2 }).setStatus('ok').updateName('renamed')
    span.end()

    expect(ended[0].attributes).toEqual({ a: 1, b: 2 })
    expect(ended[0].name).toBe('renamed')
    expect(ended[0].status).toEqual({ code: 'ok' })
  })

  it('replaces the name up until end', () => {
    // A route template is often only knowable after routing resolves, and the
    // product aggregates by (service, name) — so renaming has to be possible.
    const span = createSpan({ name: 'HTTP request' })
    span.updateName('GET /users/:id')
    span.end()
    expect(ended[0].name).toBe('GET /users/:id')
  })

  it('replaces an empty name rather than dropping the span', () => {
    const span = createSpan()
    span.updateName('   ')
    span.end()
    expect(ended[0].name).toBe('unknown')
  })

  it('applies last-write-wins to status', () => {
    const span = createSpan()
    span.setStatus('ok')
    span.setStatus('error', 'boom')
    span.end()
    expect(ended[0].status).toEqual({ code: 'error', message: 'boom' })
  })

  it('omits status when never set', () => {
    createSpan().end()
    expect(ended[0].status).toBeUndefined()
  })

  describe('recordException', () => {
    it('sets error status and attaches an exception event without ending', () => {
      const span = createSpan()
      span.recordException(new TypeError('boom'))

      expect(ended).toHaveLength(0)

      span.end()
      expect(ended[0].status).toEqual({ code: 'error', message: 'boom' })
      expect(ended[0].events).toEqual([
        expect.objectContaining({
          name: 'exception',
          attributes: { 'exception.type': 'TypeError', 'exception.message': 'boom' },
        }),
      ])
    })
  })

  describe('timestamps', () => {
    it('records an end at or after the start', () => {
      const span = createSpan()
      span.end()
      expect(ended[0].endTime).toBeGreaterThanOrEqual(ended[0].startTime)
    })

    it('honours an explicit end time', () => {
      const start = 1_700_000_000_000
      const span = createSpan({ startTime: start, backdated: true })
      span.end(start + 5000)
      expect(ended[0].endTime).toBe(start + 5000)
    })

    it('accepts a Date as an end time', () => {
      const start = 1_700_000_000_000
      const span = createSpan({ startTime: start, backdated: true })
      span.end(new Date(start + 1000))
      expect(ended[0].endTime).toBe(start + 1000)
    })

    it('corrects an end before the start to a zero duration', () => {
      const start = 1_700_000_000_000
      const span = createSpan({ startTime: start, backdated: true })
      span.end(start - 5000)
      expect(ended[0].endTime).toBe(start)
    })

    it('falls back to the derived end for an out-of-range end time', () => {
      const start = 1_700_000_000_000
      const span = createSpan({ startTime: start, backdated: true })
      span.end(Number.MAX_SAFE_INTEGER)
      expect(ended[0].endTime).toBeGreaterThanOrEqual(start)
      expect(ended[0].endTime).toBeLessThan(9_223_372_036_854)
    })

    it('keeps event timestamps inside the span window', () => {
      const span = createSpan()
      span.addEvent('cache miss')
      span.end()

      const [event] = ended[0].events
      expect(event.timestamp).toBeGreaterThanOrEqual(ended[0].startTime)
      expect(event.timestamp).toBeLessThanOrEqual(ended[0].endTime)
    })

    it('honours an explicit event timestamp', () => {
      const start = 1_700_000_000_000
      const span = createSpan({ startTime: start, backdated: true })
      span.addEvent('cache miss', undefined, start + 40)
      span.end(start + 80)
      expect(ended[0].events[0].timestamp).toBe(start + 40)
    })

    it('snapshots event attributes so a reused object cannot mutate them', () => {
      const span = createSpan()
      const reused = { attempt: 1 }
      span.addEvent('retry', reused)
      reused.attempt = 2
      span.addEvent('retry', reused)
      span.end()

      expect(ended[0].events.map((event) => event.attributes)).toEqual([{ attempt: 1 }, { attempt: 2 }])
    })
  })

  describe('context propagation', () => {
    it('produces a sampled traceparent', () => {
      expect(createSpan().traceparent()).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`)
    })

    it('returns null tracestate when it has none', () => {
      expect(createSpan().tracestate()).toBeNull()
    })

    it('returns the tracestate it was created with', () => {
      expect(createSpan({ traceState: 'vendor=abc' }).tracestate()).toBe('vendor=abc')
    })

    it('exposes a child context carrying its own span id as the parent', () => {
      expect(createSpan({ traceState: 'vendor=abc' }).childContext()).toEqual({
        traceId: TRACE_ID,
        parentSpanId: SPAN_ID,
        traceState: 'vendor=abc',
      })
    })
  })
})

describe('NoopSpan', () => {
  it('supports the full surface without throwing', () => {
    expect(() => {
      NOOP_SPAN.setAttribute('a', 1)
        .setAttributes({ b: 2 })
        .addEvent('x')
        .setStatus('error', 'boom')
        .recordException(new Error('boom'))
        .updateName('renamed')
        .end()
    }).not.toThrow()
  })

  it('never produces a well-formed traceparent', () => {
    // An id that was never recorded must not propagate to another service.
    expect(NOOP_SPAN.traceparent()).toBeNull()
    expect(NOOP_SPAN.tracestate()).toBeNull()
  })
})

describe('describeError', () => {
  it.each([
    ['an Error', new Error('boom'), { type: 'Error', message: 'boom' }],
    ['a TypeError', new TypeError('bad type'), { type: 'TypeError', message: 'bad type' }],
    ['a string', 'just a string', { type: 'string', message: 'just a string' }],
    ['an object with a message', { name: 'CustomError', message: 'oops' }, { type: 'CustomError', message: 'oops' }],
    ['an object without a name', { message: 'oops' }, { type: 'Object', message: 'oops' }],
  ])('describes %s', (_name, error, expected) => {
    expect(describeError(error)).toEqual(expected)
  })

  it('describes a thrown primitive', () => {
    // Anything can be thrown in JS, so a non-Error must still produce a usable
    // exception event rather than being dropped.
    expect(describeError(42)).toEqual({ type: 'number', message: '42' })
  })

  it('survives a value whose toString throws', () => {
    const hostile = {
      message: 123,
      toString() {
        throw new Error('boom from toString')
      },
    }
    expect(() => describeError(hostile)).not.toThrow()
    expect(describeError(hostile)).toEqual({ type: 'object', message: '' })
  })

  it('survives a value whose message getter throws', () => {
    const hostile = {
      get message(): string {
        throw new Error('boom from getter')
      },
    }
    expect(() => describeError(hostile)).not.toThrow()
  })
})
