import { NOOP_SPAN, PostHogSpan, describeError, truncateAttributeValue } from './span'
import { buildOtlpSpan } from './otlp'
import type { SpanInit } from './span'
import type { SpanRecord } from './types'
import type { Logger } from '../types'
import { createMockLogger } from '@/testing'
import { MAX_JSON_SAFE_VALUE_ITEMS, MAX_JSON_SAFE_VALUE_NODES } from '../utils/json-utils'

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
        maxAttributesPerEvent: 128,
        maxAttributeValueLength: 8192,
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

  describe('event cap', () => {
    const fillEvents = (span: PostHogSpan, count: number): void => {
      for (let i = 0; i < count; i++) {
        span.addEvent(`step-${i}`)
      }
    }

    it('drops an exception event on a span that has filled its events', () => {
      // The cap is absolute, so an exception arriving last is dropped like any
      // other event. The span keeps its `error` status and `droppedEventsCount`
      // reports the loss, which is what makes the case findable in production.
      const span = createSpan({ maxEvents: 2 })
      fillEvents(span, 2)
      span.recordException(new Error('boom'))
      span.end()

      expect(ended[0].events.map((event) => event.name)).toEqual(['step-0', 'step-1'])
      expect(ended[0].status).toEqual({ code: 'error', message: 'boom' })
      expect(ended[0].droppedEventsCount).toBe(1)
    })

    it('records an exception like any other event while the cap has room', () => {
      const span = createSpan({ maxEvents: 128 })
      for (let i = 0; i < 20; i++) {
        span.recordException(new Error(`boom-${i}`))
      }
      span.end()

      expect(ended[0].events).toHaveLength(20)
      expect(ended[0].droppedEventsCount).toBeUndefined()
    })

    it('does not let an exception-named event bypass the cap', () => {
      // The cap counts events, not names: nothing about the name `exception`
      // buys a slot, whoever wrote it.
      const span = createSpan({ maxEvents: 2 })
      for (let i = 0; i < 7; i++) {
        span.addEvent('exception', { mine: i })
      }
      span.end()

      expect(ended[0].events).toHaveLength(2)
      expect(ended[0].droppedEventsCount).toBe(5)
    })

    it('drops ordinary events past the cap', () => {
      const span = createSpan({ maxEvents: 2 })
      fillEvents(span, 5)
      span.end()

      expect(ended[0].events.map((event) => event.name)).toEqual(['step-0', 'step-1'])
      expect(ended[0].droppedEventsCount).toBe(3)
    })
  })

  describe('event attribute cap', () => {
    it('keeps the first attributes and reports the rest as dropped', () => {
      const span = createSpan({ maxAttributesPerEvent: 2 })
      span.addEvent('query', { a: 1, b: 2, c: 3, d: 4 })
      span.end()

      expect(ended[0].events[0].attributes).toEqual({ a: 1, b: 2 })
      expect(ended[0].events[0].droppedAttributesCount).toBe(2)
    })

    it('leaves the count off an event that lost nothing', () => {
      const span = createSpan({ maxAttributesPerEvent: 2 })
      span.addEvent('query', { a: 1, b: 2 })
      span.end()

      expect(ended[0].events[0].droppedAttributesCount).toBeUndefined()
    })

    it('bounds an exception event like any other', () => {
      // The SDK's own `exception.*` attributes are width the caller sees too, so
      // they spend the cap rather than being exempt from it.
      const span = createSpan({ maxAttributesPerEvent: 1 })
      span.recordException(new Error('boom'))
      span.end()

      expect(Object.keys(ended[0].events[0].attributes ?? {})).toEqual(['exception.type'])
      expect(ended[0].events[0].droppedAttributesCount).toBe(2)
    })

    it('does not read a value past the cap', () => {
      // The cap is spent before the value is bounded, so a wide bag does not pay
      // for getters on entries that are about to be dropped.
      const read: string[] = []
      const watched: any = {}
      for (const key of ['a', 'b', 'c']) {
        Object.defineProperty(watched, key, {
          enumerable: true,
          get() {
            read.push(key)
            return key
          },
        })
      }

      const span = createSpan({ maxAttributesPerEvent: 2 })
      span.addEvent('query', watched)
      span.end()

      expect(read).toEqual(['a', 'b'])
      expect(ended[0].events[0].droppedAttributesCount).toBe(1)
    })

    it('does not let a nullish value spend a slot', () => {
      // The encoder drops these, so a caller who blanked a value rather than
      // omitting the key must not cost the event a real attribute. Same rule the
      // span half of the cap already follows.
      const span = createSpan({ maxAttributesPerEvent: 2 })
      span.addEvent('query', { blanked: undefined, cleared: null, real: 1, second: 2 })
      span.end()

      expect(ended[0].events[0].attributes).toEqual({ real: 1, second: 2 })
      expect(ended[0].events[0].droppedAttributesCount).toBeUndefined()
    })

    it('survives an attribute bag whose own keys cannot be read', () => {
      const hostile = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('ownKeys exploded')
          },
        }
      )
      const span = createSpan()
      expect(() => span.addEvent('query', hostile)).not.toThrow()
      expect(() => span.end()).not.toThrow()

      expect(ended[0].events[0].attributes).toEqual({})
    })

    it('counts the span attribute cap separately from an event cap', () => {
      // maxAttributesPerSpan does not reach inside events, which is the gap this
      // cap closes: a span at its own cap can still carry full-width events.
      const span = createSpan({ maxAttributes: 1, maxAttributesPerEvent: 3 })
      span.setAttributes({ kept: 1, dropped: 2 })
      span.addEvent('query', { a: 1, b: 2, c: 3 })
      span.end()

      expect(ended[0].attributes).toEqual({ kept: 1 })
      expect(ended[0].droppedAttributesCount).toBe(1)
      expect(ended[0].events[0].attributes).toEqual({ a: 1, b: 2, c: 3 })
      expect(ended[0].events[0].droppedAttributesCount).toBeUndefined()
    })
  })

  describe('attribute store hygiene', () => {
    it('does not copy a polluted Object.prototype key into the span', () => {
      ;(Object.prototype as any).polluted = 'yes'
      try {
        const span = createSpan({ attributes: { real: 1 } })
        span.end()

        expect(Object.keys(ended[0].attributes)).toEqual(['real'])
      } finally {
        delete (Object.prototype as any).polluted
      }
    })
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
          attributes: expect.objectContaining({ 'exception.type': 'TypeError', 'exception.message': 'boom' }),
        }),
      ])
    })

    it('attaches the stack as exception.stacktrace', () => {
      const span = createSpan()
      span.recordException(new TypeError('boom'))
      span.end()

      const stack = ended[0].events[0].attributes?.['exception.stacktrace']
      expect(stack).toEqual(expect.stringContaining('TypeError: boom'))
    })

    it('bounds the stack by maxAttributeValueLength', () => {
      const span = createSpan({ maxAttributeValueLength: 40 })
      const error = new Error('boom')
      error.stack = `Error: boom\n${'    at somewhere deep\n'.repeat(500)}`

      span.recordException(error)
      span.end()

      expect(ended[0].events[0].attributes?.['exception.stacktrace']).toHaveLength(40)
    })

    it('records an exception with no stack without inventing one', () => {
      const span = createSpan()
      span.recordException('just a string')
      span.end()

      expect(ended[0].events[0].attributes).not.toHaveProperty('exception.stacktrace')
    })
  })

  describe('maxAttributeValueLength', () => {
    it('truncates a long string attribute without counting it as dropped', () => {
      const span = createSpan({ maxAttributeValueLength: 10 })
      span.setAttribute('payload', 'x'.repeat(5000))
      span.end()

      expect(ended[0].attributes.payload).toBe('xxxxxxxxxx')
      // The count is for whole entries; a trimmed value is still exported.
      expect(ended[0].droppedAttributesCount).toBeUndefined()
    })

    it('truncates the strings inside an array attribute, and leaves other types alone', () => {
      const span = createSpan({ maxAttributeValueLength: 3 })
      span.setAttributes({ tags: ['abcdef', 'ab'], count: 1234567, flag: true })
      span.end()

      expect(ended[0].attributes).toMatchObject({ tags: ['abc', 'ab'], count: 1234567, flag: true })
    })

    it('truncates strings nested inside an object value', () => {
      // `setAttribute('payload', { body: res.body })` is the natural way to attach
      // a response, and an unbounded one is what pushes a span past the endpoint.
      const span = createSpan({ maxAttributeValueLength: 4 })
      span.setAttribute('payload', { body: 'abcdefgh', status: 200 })
      span.end()

      expect(ended[0].attributes.payload).toEqual({ body: 'abcd', status: 200 })
    })

    it('truncates strings nested inside an array value', () => {
      const span = createSpan({ maxAttributeValueLength: 4 })
      span.setAttribute('rows', [{ body: 'abcdefgh' }, ['abcdefgh']])
      span.end()

      expect(ended[0].attributes.rows).toEqual([{ body: 'abcd' }, ['abcd']])
    })

    it('bounds the work a shared subtree costs, not just a cyclic one', () => {
      // Siblings pointing at one object are re-walked once per path, so this
      // reaches the same leaves ten million times. Only the node budget stops it.
      const leaf: string[] = []
      for (let i = 0; i < 1000; i++) {
        leaf.push('x'.repeat(2000))
      }
      const mid = Array.from({ length: 1000 }, () => leaf)
      const shared = Array.from({ length: 10 }, () => mid)

      const bounded = truncateAttributeValue(shared, 8)

      // Counting what the walk shortened, not what the result can reach: past
      // the budget the original is handed back by reference.
      const cap = MAX_JSON_SAFE_VALUE_NODES * 2
      let shortened = 0
      const stack: unknown[] = [bounded]
      while (stack.length && shortened <= cap) {
        const value = stack.pop()
        if (typeof value === 'string') {
          if (value.length === 8) {
            shortened++
          }
        } else if (Array.isArray(value) && value !== leaf && value !== mid) {
          stack.push(...value)
        }
      }
      expect(shortened).toBeLessThanOrEqual(cap)
    })

    it('terminates on a self-referencing value', () => {
      const cyclic: any = { body: 'abcdefgh' }
      cyclic.self = cyclic
      const span = createSpan({ maxAttributeValueLength: 4 })

      expect(() => {
        span.setAttribute('payload', cyclic)
        span.end()
      }).not.toThrow()
    })

    it('charges a throwing accessor to its own key, still bounding its siblings', () => {
      // A lazy ORM relation next to a large field is the shape that matters: if
      // the throw abandons the whole walk, the large field ships at full length.
      const span = createSpan({ maxAttributeValueLength: 4 })
      const hostile = {
        ok: 'abcdefgh',
        get boom() {
          throw new Error('getter exploded')
        },
      }

      expect(() => {
        span.setAttribute('payload', hostile as any)
        span.end()
      }).not.toThrow()

      const payload = ended[0].attributes.payload as Record<string, unknown>
      expect(payload.ok).toBe('abcd')
      expect(payload.boom).toBe('[Unserializable]')
    })

    it('does not walk into a value whose toJSON redacts it', () => {
      // Copying the object's own keys would hand the encoder a plain object it
      // no longer recognises as self-describing, putting the internals of a
      // value that redacts itself on the wire.
      class Redacted {
        constructor(public secret: string) {}
        toJSON(): null {
          return null
        }
      }
      const span = createSpan({ maxAttributeValueLength: 10 })

      span.setAttribute('payload', { inner: new Redacted('S'.repeat(50)) } as any)
      span.end()

      // The string the encoder builds from the same `null`, so the wire is
      // unchanged, and the secret is nowhere in what the span kept.
      expect((ended[0].attributes.payload as any).inner).toBe('null')
      expect(JSON.stringify(ended[0].attributes)).not.toContain('S')
    })

    it('materializes a toJSON that resolves to nothing, so a second call cannot answer differently', () => {
      // Keeping the object itself left the encoder to probe toJSON again. A
      // serializer that answered `null` here could answer with a megabyte
      // there, past the bound entirely.
      let calls = 0
      const stateful = {
        toJSON: () => {
          calls++
          return calls === 1 ? null : 'x'.repeat(100)
        },
      }
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.setAttribute('doc', stateful as any)
      span.end()

      expect(calls).toBe(1)
      expect(ended[0].attributes.doc).toBe('null')
    })

    it('keeps a stateful toJSON bounded through to the encoded span', () => {
      // End to end, because the second call is the encoder's: what the span
      // stored has to leave it nothing to call.
      let calls = 0
      const stateful = {
        toJSON: () => {
          calls++
          return calls === 1 ? null : 'x'.repeat(100)
        },
      }
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.setAttribute('doc', stateful as any)
      span.end()
      const encoded = buildOtlpSpan(ended[0])

      expect(calls).toBe(1)
      expect(encoded.attributes?.find((attribute) => attribute.key === 'doc')).toEqual({
        key: 'doc',
        value: { stringValue: 'null' },
      })
    })

    it('describes a toJSON resolving to undefined the way the encoder would', () => {
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.setAttribute('ghost', { toJSON: () => undefined } as any)
      span.end()

      // Not trimmed to the bound: this is the SDK's own marker, like
      // `[Circular]`, and `unde` reads as nothing at all.
      expect(ended[0].attributes.ghost).toBe('undefined')
    })

    it('bounds event attributes too', () => {
      const span = createSpan({ maxAttributeValueLength: 4 })
      span.addEvent('cache.miss', { key: 'abcdefgh' })
      span.end()

      expect(ended[0].events[0].attributes).toEqual({ key: 'abcd' })
    })

    it('walks a value that points at itself twice only once', () => {
      // Depth alone is not a bound. Two back-references at each level cost
      // 2 ** 20 visits, which is a quarter-second inside the caller's own
      // `setAttribute` call, and a third reference is minutes.
      let reads = 0
      const cyclic: any = {
        get body() {
          reads++
          return 'abcdefgh'
        },
      }
      cyclic.self1 = cyclic
      cyclic.self2 = cyclic
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.setAttribute('payload', cyclic)
      span.end()

      expect(reads).toBe(1)
    })

    it('bounds the nodes an acyclic value costs, not just its depth', () => {
      // Siblings sharing a subtree are not a cycle, so the ancestor set does not
      // catch them: 3 ** 12 visits without a node budget.
      let reads = 0
      let level: any = {
        get body() {
          reads++
          return 'abcdefgh'
        },
      }
      for (let i = 0; i < 12; i++) {
        level = { a: level, b: level, c: level }
      }
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.setAttribute('payload', level)
      span.end()

      expect(reads).toBeLessThanOrEqual(10_000)
    })

    it('bounds the value a toJSON produces, which is what the encoder puts on the wire', () => {
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.setAttribute('doc', { toJSON: () => 'abcdefgh' } as any)
      span.end()

      expect(ended[0].attributes.doc).toBe('abcd')
    })

    it('resolves toJSON exactly once, so a second call cannot dodge the bound', () => {
      // Returning the original object when nothing needed shortening left the
      // encoder to call toJSON again — a value that answered differently the
      // second time reached the wire unbounded.
      let calls = 0
      const doc = {
        toJSON: () => {
          calls++
          return calls === 1 ? 'ab' : 'x'.repeat(4000)
        },
      }
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.setAttribute('doc', doc as any)
      span.end()

      expect(calls).toBe(1)
      expect(ended[0].attributes.doc).toBe('ab')
    })

    it('bounds a string that follows a large collection of nulls', () => {
      // The encoder drops a nullish value without spending its budget, so a walk
      // that charges for one runs out first and leaves the string after it
      // unbounded on both sides — a 2 MB value under a bound of 8.
      const span = createSpan({ maxAttributeValueLength: 8 })

      span.setAttribute('payload', {
        rows: Array.from({ length: 400 }, () =>
          Object.fromEntries(Array.from({ length: 50 }, (_unused, index) => [`c${index}`, null]))
        ),
        html: 'X'.repeat(50000),
      })
      span.end()

      expect((ended[0].attributes.payload as any).html).toHaveLength(8)
    })

    it('bounds a string that follows a large collection', () => {
      // The traversal budget is spent on containers, not leaves: a big array
      // used to exhaust it and leave every later string at full length.
      const span = createSpan({ maxAttributeValueLength: 8 })

      span.setAttribute('payload', {
        rows: Array.from({ length: 20000 }, (_, index) => index),
        html: 'X'.repeat(50000),
      })
      span.end()

      expect((ended[0].attributes.payload as any).html).toHaveLength(8)
    })

    it('keeps a nested __proto__ key as an ordinary entry', () => {
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.setAttribute('payload', JSON.parse('{"__proto__": {"body": "abcdefgh"}}'))
      span.end()

      const payload = ended[0].attributes.payload as Record<string, unknown>
      expect(Object.keys(payload)).toEqual(['__proto__'])
      expect(Object.getOwnPropertyDescriptor(payload, '__proto__')?.value).toEqual({ body: 'abcd' })
    })

    it('bounds an event name the SDK records like any other', () => {
      const span = createSpan({ maxAttributeValueLength: 8, maxEvents: 4 })

      span.recordException(new Error('boom'))
      span.end()

      expect(ended[0].events[0].name).toBe('exceptio')
      expect(ended[0].events[0].attributes?.['exception.type']).toBe('Error')
    })

    it('bounds a span name and an event name, like a status message', () => {
      // A name built from a URL is caller-controlled, and one large enough takes
      // the span past the ingestion body limit.
      const span = createSpan({ maxAttributeValueLength: 12 })

      span.updateName('abcdefghijklmnop')
      span.addEvent('abcdefghijklmnop')
      span.end()

      expect(ended[0].name).toBe('abcdefghijkl')
      expect(ended[0].events[0].name).toBe('abcdefghijkl')
    })

    it('bounds a status message', () => {
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.setStatus('error', 'abcdefgh')
      span.end()

      expect(ended[0].status).toEqual({ code: 'error', message: 'abcd' })
    })

    it('bounds the status message recordException sets, like the event attribute', () => {
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.recordException(new Error('abcdefgh'))
      span.end()

      expect(ended[0].status?.message).toBe('abcd')
      expect(ended[0].events[0].attributes?.['exception.message']).toBe('abcd')
    })

    it('replaces a back-reference with the marker rather than the value itself', () => {
      // Handing the raw ancestor back left it inside a copied parent, where the
      // encoder's own cycle detection no longer recognised it and walked one
      // more level of its strings at full length.
      const cyclic: any = { body: 'abcdefgh' }
      cyclic.self = cyclic
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.setAttribute('payload', cyclic)
      span.end()

      expect(ended[0].attributes.payload).toEqual({ body: 'abcd', self: '[Circular]' })
    })

    it('still bounds an array whose accessor past the encoder cap throws', () => {
      // `slice()` read the whole array to copy it, so one throwing accessor
      // beyond the encoder's cap cost every item in range its bound.
      const rows: unknown[] = ['abcdefgh']
      for (let index = 1; index < MAX_JSON_SAFE_VALUE_ITEMS + 200; index++) {
        rows.push('x')
      }
      Object.defineProperty(rows, MAX_JSON_SAFE_VALUE_ITEMS + 100, {
        get: () => {
          throw new Error('lazy relation')
        },
        enumerable: true,
        configurable: true,
      })
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.setAttribute('rows', rows as any)
      span.end()

      expect((ended[0].attributes.rows as unknown[])[0]).toBe('abcd')
    })

    it('stops reading keys where the encoder stops emitting them', () => {
      // Every key was read even though the encoder emits at most the cap, so a
      // wide object charged `setAttribute` for getters that never ship.
      let reads = 0
      const wide: Record<string, unknown> = {}
      for (let index = 0; index < MAX_JSON_SAFE_VALUE_ITEMS * 2; index++) {
        Object.defineProperty(wide, `k${index}`, {
          get: () => {
            reads++
            return 'v'
          },
          enumerable: true,
          configurable: true,
        })
      }
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.setAttribute('payload', wide)
      span.end()

      expect(reads).toBe(MAX_JSON_SAFE_VALUE_ITEMS)
    })

    it('copies a nested value the caller goes on to mutate', () => {
      // A value that needed no truncation was attached as it came, so the span
      // held caller-owned state and shipped whatever it was changed to.
      const nested = { body: 'ok' }
      const span = createSpan({ maxAttributeValueLength: 4 })

      span.setAttribute('payload', { nested })
      nested.body = 'abcdefgh'
      span.end()

      expect(ended[0].attributes.payload).toEqual({ nested: { body: 'ok' } })
    })

    it('leaves a Date whole rather than truncating its timestamp', () => {
      // The encoder emits a Date from its own branch ahead of any `toJSON`, so
      // bounding it here shipped a cut-off timestamp instead of a shorter one.
      const span = createSpan({ maxAttributeValueLength: 10 })

      span.setAttribute('when', new Date('2020-01-02T03:04:05.000Z') as never)
      span.end()

      expect(ended[0].attributes.when).toEqual(new Date('2020-01-02T03:04:05.000Z'))
    })

    it('bounds an SDK-attached value, which is exempt from the count cap only', () => {
      const span = createSpan({
        maxAttributeValueLength: 4,
        attributes: { posthogDistinctId: 'user-12345' },
        autoAttributeKeys: ['posthogDistinctId'],
      })
      span.setAttribute('posthogDistinctId', 'user-12345')
      span.end()

      expect(ended[0].attributes.posthogDistinctId).toBe('user')
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

describe('attribute store', () => {
  it('hands out a record whose attributes behave like an ordinary object', () => {
    const ended: SpanRecord[] = []
    const span = new PostHogSpan(
      {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        name: 'checkout',
        kind: 'internal',
        attributes: { plan: 'pro' },
        startTime: Date.now(),
        backdated: false,
        autoAttributeKeys: [],
        maxAttributes: 128,
        maxEvents: 128,
        maxAttributesPerEvent: 128,
        maxAttributeValueLength: 8192,
      },
      (record) => ended.push(record)
    )
    span.end()

    const { attributes } = ended[0]
    expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(attributes, 'plan')).toBe(true)
    expect(() => JSON.stringify(attributes)).not.toThrow()
  })

  it('keeps a parsed __proto__ key as an ordinary attribute', () => {
    const ended: SpanRecord[] = []
    const span = new PostHogSpan(
      {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        name: 'checkout',
        kind: 'internal',
        attributes: JSON.parse('{"__proto__": {"leaked": 1}, "orderId": "abc"}'),
        startTime: Date.now(),
        backdated: false,
        autoAttributeKeys: [],
        maxAttributes: 128,
        maxEvents: 128,
        maxAttributesPerEvent: 128,
        maxAttributeValueLength: 8192,
      },
      (record) => ended.push(record)
    )
    span.end()

    const keys: string[] = []
    for (const key in ended[0].attributes) {
      keys.push(key)
    }
    expect(keys).not.toContain('leaked')
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
    expect(describeError(error)).toMatchObject(expected)
  })

  it('carries the stack where the thrown value has one, and nothing where it does not', () => {
    expect(describeError(new Error('boom')).stack).toEqual(expect.stringContaining('Error: boom'))
    expect(describeError('just a string').stack).toBeUndefined()
    expect(describeError({ message: 'oops' }).stack).toBeUndefined()
  })

  it('survives a throwing stack accessor', () => {
    const hostile = {
      message: 'oops',
      get stack() {
        throw new Error('nope')
      },
    }
    expect(describeError(hostile)).toEqual({ type: 'Object', message: 'oops' })
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
