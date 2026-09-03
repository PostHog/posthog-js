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
        ...init,
      },
      (record) => ended.push(record),
      logger
    )

  beforeEach(() => {
    ended = []
    logger = createMockLogger()
  })

  describe('monotonic clock', () => {
    const withMonotonic = (readings: number[], run: () => void): void => {
      const original = (globalThis as any).performance
      let index = 0
      ;(globalThis as any).performance = { now: () => readings[Math.min(index++, readings.length - 1)] }
      try {
        run()
      } finally {
        ;(globalThis as any).performance = original
      }
    }

    it('measures duration against the monotonic reading, not the wall clock', () => {
      const start = Date.now()
      withMonotonic([1000, 1025], () => {
        const span = createSpan({ startTime: start })
        vi.spyOn(Date, 'now').mockReturnValue(start - 60_000)
        span.end()
      })
      vi.spyOn(Date, 'now').mockRestore()

      expect(ended[0].endTime - ended[0].startTime).toBe(25)
    })

    it('never reports a negative duration when the monotonic source goes backwards', () => {
      const start = Date.now()
      withMonotonic([1000, 900], () => {
        createSpan({ startTime: start }).end()
      })

      expect(ended[0].endTime).toBe(ended[0].startTime)
    })

    it('places an event inside the span window', () => {
      const start = Date.now()
      withMonotonic([1000, 1010, 1040], () => {
        const span = createSpan({ startTime: start })
        span.addEvent('cache-miss')
        span.end()
      })

      const [record] = ended
      expect(record.events[0].timestamp).toBeGreaterThanOrEqual(record.startTime)
      expect(record.events[0].timestamp).toBeLessThanOrEqual(record.endTime)
    })

    it('uses the wall clock for a backdated span', () => {
      withMonotonic([1000, 9999], () => {
        createSpan({ startTime: Date.now() - 5000, backdated: true }).end()
      })

      expect(ended[0].endTime - ended[0].startTime).toBeGreaterThanOrEqual(5000)
    })
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

  it('ignores an unrecognized status along with its message', () => {
    const rejected = createSpan()
    expect((rejected as any).setStatus('OK', 'all good')).toBe(rejected)
    rejected.end()

    const corrected = createSpan()
    ;(corrected as any).setStatus('OK', 'all good')
    corrected.setStatus('error', 'boom')
    corrected.end()

    expect(ended[0].status).toBeUndefined()
    expect(ended[1].status).toEqual({ code: 'error', message: 'boom' })
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('OK'))
  })

  describe('poison attributes', () => {
    const withThrowingGetter = (): any => {
      const attributes: any = { ok: 1 }
      Object.defineProperty(attributes, 'boom', {
        enumerable: true,
        get() {
          throw new Error('getter exploded')
        },
      })
      return attributes
    }

    it('marks only the throwing key on setAttributes', () => {
      const span = createSpan()
      expect(() => span.setAttributes(withThrowingGetter())).not.toThrow()
      span.end()

      expect(ended[0].attributes).toEqual({ ok: 1, boom: '[Unserializable]' })
    })

    it('marks only the throwing key on addEvent', () => {
      const span = createSpan()
      expect(() => span.addEvent('checkout.step', withThrowingGetter())).not.toThrow()
      span.end()

      expect(ended[0].events[0].attributes).toEqual({ ok: 1, boom: '[Unserializable]' })
    })

    it('keeps a __proto__ key on setAttribute', () => {
      const span = createSpan()
      span.setAttribute('__proto__', 'polluted')
      span.end()

      expect(Object.keys(ended[0].attributes)).toContain('__proto__')
      expect(Object.getPrototypeOf(ended[0].attributes)).toBe(Object.prototype)
    })

    it('copies only own enumerable keys on setAttributes', () => {
      const span = createSpan()
      span.setAttributes(Object.create({ inherited: 'proto' }, { own: { value: 'yes', enumerable: true } }))
      span.end()

      expect(ended[0].attributes).toEqual({ own: 'yes' })
    })
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

    it('propagates the trace flags it was started with', () => {
      expect(createSpan({ traceFlags: '00' }).traceparent()).toBe(`00-${TRACE_ID}-${SPAN_ID}-00`)
      expect(createSpan().traceparent()).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`)
    })

    it('hands a child the flags it propagates, so the whole chain agrees', () => {
      expect(createSpan({ traceFlags: '00' }).childContext().traceFlags).toBe('00')
    })

    it('exposes a child context carrying its own span id as the parent', () => {
      expect(createSpan({ traceState: 'vendor=abc' }).childContext()).toEqual({
        traceId: TRACE_ID,
        parentSpanId: SPAN_ID,
        traceState: 'vendor=abc',
        traceFlags: '01',
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
