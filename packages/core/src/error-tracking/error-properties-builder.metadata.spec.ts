import { ErrorCoercer, ErrorEventCoercer, ObjectCoercer, PrimitiveCoercer, StringCoercer } from './coercers'
import { ErrorPropertiesBuilder } from './error-properties-builder'
import { chromeStackLineParser, createStackParser } from './parsers'

// Canonical nested_cause and aggregate examples from the exception-event-metadata specification.
describe('ErrorPropertiesBuilder relationship metadata', () => {
  const builder = new ErrorPropertiesBuilder(
    [new ErrorEventCoercer(), new ErrorCoercer(), new ObjectCoercer(), new StringCoercer(), new PrimitiveCoercer()],
    createStackParser('web:javascript', chromeStackLineParser)
  )
  function error(type: string, value: string, cause?: unknown): Error {
    const result = new Error(value, { cause })
    result.name = type
    result.stack = undefined
    return result
  }

  it('matches the canonical cause example without inventing nested handled state', () => {
    expect(
      builder.buildFromUnknown(error('CheckoutError', 'Checkout failed', error('DatabaseError', 'Connection failed')))
    ).toEqual({
      $exception_level: 'error',
      $exception_list: [
        {
          type: 'CheckoutError',
          value: 'Checkout failed',
          mechanism: { type: 'generic', handled: true, synthetic: false, exception_id: 0 },
        },
        {
          type: 'DatabaseError',
          value: 'Connection failed',
          mechanism: { type: 'chained', source: 'cause', synthetic: false, exception_id: 1, parent_id: 0 },
        },
      ],
    })
  })

  it('matches the canonical aggregate example including the second member cause', () => {
    const root = new AggregateError(
      [
        error('NetworkError', 'Network failed'),
        error('ValidationError', 'Validation failed', error('ParseError', 'Invalid value')),
      ],
      'Two operations failed'
    )
    root.stack = undefined
    expect(builder.buildFromUnknown(root, { mechanism: { type: 'task', handled: false } }).$exception_list).toEqual([
      {
        type: 'AggregateError',
        value: 'Two operations failed',
        mechanism: { type: 'task', handled: false, synthetic: false, exception_id: 0 },
      },
      {
        type: 'NetworkError',
        value: 'Network failed',
        mechanism: { type: 'chained', source: 'member', synthetic: false, exception_id: 1, parent_id: 0 },
      },
      {
        type: 'ValidationError',
        value: 'Validation failed',
        mechanism: { type: 'chained', source: 'member', synthetic: false, exception_id: 2, parent_id: 0 },
      },
      {
        type: 'ParseError',
        value: 'Invalid value',
        mechanism: { type: 'chained', source: 'cause', synthetic: false, exception_id: 3, parent_id: 2 },
      },
    ])
  })

  it('retains the first 50 entries of a deep cause chain with deterministic valid IDs', () => {
    let root = error('Error', '60')
    for (let index = 59; index >= 0; index--) root = error('Error', String(index), root)
    const first = builder.buildFromUnknown(root).$exception_list
    expect(first).toEqual(builder.buildFromUnknown(root).$exception_list)
    expect(first.map((entry) => entry.value)).toEqual(Array.from({ length: 50 }, (_, index) => String(index)))
    first.forEach((entry, index) => {
      expect(entry.mechanism?.exception_id).toBe(index)
      if (index) expect(entry.mechanism?.parent_id).toBe(index - 1)
    })
  })

  it('skips cycles and shared objects globally without spending the emission budget', () => {
    const shared = error('Error', 'shared')
    const root = new AggregateError([], 'root', { cause: shared })
    shared.cause = root
    root.errors = [
      ...Array(150).fill(root),
      ...Array(150).fill(shared),
      ...Array.from({ length: 60 }, (_, index) => error('Error', String(index))),
    ]
    expect(builder.buildFromUnknown(root).$exception_list.map((entry) => entry.value)).toEqual([
      'root',
      'shared',
      ...Array.from({ length: 48 }, (_, index) => String(index)),
    ])
  })

  it('does not read handled properties from user errors or inherit root provenance', () => {
    const child = error('Error', 'native')
    Object.defineProperty(child, 'handled', {
      get() {
        throw new Error('untrusted')
      },
    })
    const root = new AggregateError([child, 'converted'], 'root')
    root.stack = undefined
    const entries = builder.buildFromUnknown(root, {
      syntheticException: new Error('capture'),
      mechanism: { handled: false, type: 'middleware' },
    }).$exception_list
    expect(entries.map((entry) => entry.mechanism)).toEqual([
      { type: 'middleware', handled: false, synthetic: true, exception_id: 0 },
      { type: 'chained', source: 'member', synthetic: false, exception_id: 1, parent_id: 0 },
      { type: 'chained', source: 'member', synthetic: true, exception_id: 2, parent_id: 0 },
    ])
  })

  it('preserves typed capture metadata but assigns root linkage at final assembly', () => {
    const root = error('Error', 'root', error('Error', 'child'))
    const entries = builder.buildFromUnknown(root, {
      mechanism: {
        type: 'custom.integration',
        handled: false,
        synthetic: true,
        exception_id: 81,
        parent_id: 80,
        source: 'cause',
      },
    }).$exception_list
    expect(entries[0].mechanism).toEqual({
      type: 'custom.integration',
      handled: false,
      synthetic: true,
      exception_id: 0,
    })
    expect(entries[1].mechanism).toEqual({
      type: 'chained',
      source: 'cause',
      synthetic: false,
      exception_id: 1,
      parent_id: 0,
    })
  })
  it.each([undefined, '', 123])('keeps a native child without a usable stack non-synthetic: %s', (stack) => {
    const child = error('Error', 'child')
    child.stack = stack as string | undefined
    const entries = builder.buildFromUnknown(new Error('root', { cause: child })).$exception_list
    expect(entries[1].mechanism?.synthetic).toBe(false)
    expect(entries[1].stacktrace).toBeUndefined()
  })

  it('keeps a native child with a throwing stack accessor non-synthetic', () => {
    const child = error('Error', 'child')
    Object.defineProperty(child, 'stack', {
      get() {
        throw new Error('unreadable')
      },
    })
    const entries = builder.buildFromUnknown(new Error('root', { cause: child })).$exception_list
    expect(entries[1]).toEqual({
      type: 'Error',
      value: 'child',
      mechanism: { type: 'chained', source: 'cause', synthetic: false, exception_id: 1, parent_id: 0 },
    })
  })

  it.each(['yes', null, 0, {}, []])('omits invalid handled metadata: %j', (handled) => {
    const entries = builder.buildFromUnknown(error('Error', 'root'), {
      mechanism: { type: '', handled, synthetic: true } as any,
    }).$exception_list
    expect(entries[0].mechanism).toEqual({ type: 'generic', synthetic: true, exception_id: 0 })
    expect(entries[0].mechanism).not.toHaveProperty('handled')
  })

  it.each([undefined, true, false])(
    'preserves the manual capture default and boolean handled metadata: %s',
    (handled) => {
      const entries = builder.buildFromUnknown(error('Error', 'root'), { mechanism: { handled } }).$exception_list
      expect(entries[0].mechanism.handled).toBe(handled === undefined ? true : handled)
    }
  )

  it('preserves all supplied mechanism fields in the low-level coercion context', () => {
    const mechanism = {
      type: 'custom',
      handled: false,
      synthetic: true,
      source: 'inner',
      exception_id: 7,
      parent_id: 6,
    }
    const context = builder.buildCoercingContext(mechanism, { mechanism })
    expect(context.mechanism).toEqual(mechanism)
    context.apply(error('Error', 'root'))
    expect(context.mechanism).toEqual(mechanism)
  })

  it('deduplicates shared exceptions reached through distinct wrappers', () => {
    const shared = error('Error', 'shared')
    const root = new AggregateError([shared, { error: shared }, { error: shared }, error('Error', 'last')], 'root')
    const entries = builder.buildFromUnknown(root).$exception_list
    expect(entries.map((entry) => entry.value)).toEqual(['root', 'shared', 'last'])
    expect(entries.map((entry) => entry.mechanism?.exception_id)).toEqual([0, 1, 2])
  })

  it('resets the wrapper limit on real cause edges', () => {
    let root = error('Error', '8')
    for (let index = 7; index >= 0; index--) root = error('Error', String(index), { error: root })
    expect(builder.buildFromUnknown(root).$exception_list.map((entry) => entry.value)).toEqual(
      Array.from({ length: 9 }, (_, index) => String(index))
    )
  })

  it('bounds consecutive forwarding wrappers without discarding the next member', () => {
    let wrapper: unknown = error('Error', 'unreachable')
    for (let index = 0; index < 10; index++) wrapper = { [Symbol.toStringTag]: 'ErrorEvent', error: wrapper }
    const entries = builder.buildFromUnknown(
      new AggregateError([wrapper, error('Error', 'last')], 'root')
    ).$exception_list
    expect(entries.map((entry) => entry.value)).toEqual(['root', 'Unknown error', 'last'])
    expect(entries.map((entry) => entry.mechanism?.exception_id)).toEqual([0, 1, 2])
  })

  it.each([NaN, Infinity, -1, 1.5, 0x100000000, '2'])('ignores invalid proxy collection lengths: %s', (length) => {
    const root = new AggregateError([], 'root')
    const readMember = vi.fn()
    root.errors = new Proxy([], { get: (_target, key) => (key === 'length' ? length : readMember(key)) })
    expect(builder.buildFromUnknown(root).$exception_list.map((entry) => entry.value)).toEqual(['root'])
    expect(readMember).not.toHaveBeenCalled()
  })

  it('reads array length once and ignores later growth', () => {
    const members = [error('Error', 'first')]
    const getLength = vi.fn(() => members.length)
    const root = new AggregateError([], 'root')
    root.errors = new Proxy(members, {
      get: (target, key) => {
        if (key === 'length') return getLength()
        if (key === '0') members.push(error('Error', 'not in snapshot'))
        return Reflect.get(target, key)
      },
    })
    expect(builder.buildFromUnknown(root).$exception_list.map((entry) => entry.value)).toEqual(['root', 'first'])
    expect(getLength).toHaveBeenCalledTimes(1)
  })

  it('preserves root and cause when reading the collection length throws', () => {
    const root = new AggregateError([], 'root', { cause: error('Error', 'cause') })
    root.errors = new Proxy([], {
      get() {
        throw new Error('unreadable length')
      },
    })
    expect(builder.buildFromUnknown(root).$exception_list.map((entry) => entry.value)).toEqual(['root', 'cause'])
  })
  it('caps huge proxy member collections before reading beyond 1000 attempts and resets between captures', () => {
    const root = new AggregateError([], 'root')
    const readMember = vi.fn((index: number) => {
      // The old implementation also terminates safely: after 1000 duplicate reads,
      // fallback entries fill its emission budget rather than scanning the huge length.
      if (index >= 1000) throw new Error('past the inspection budget')
      return root
    })
    root.errors = new Proxy([], {
      get: (_target, key) => (key === 'length' ? 0xffffffff : readMember(Number(key))),
    })
    for (let capture = 0; capture < 2; capture++) {
      readMember.mockClear()
      expect(builder.buildFromUnknown(root).$exception_list.map((entry) => entry.value)).toEqual(['root'])
      expect(readMember).toHaveBeenCalledTimes(1000)
      expect(readMember).toHaveBeenLastCalledWith(999)
    }
    expect(
      builder
        .buildFromUnknown(new AggregateError([error('Error', 'fresh child')], 'fresh root'))
        .$exception_list.map((entry) => entry.value)
    ).toEqual(['fresh root', 'fresh child'])
  })

  it('shares attempted member inspections across groups, including throwing getters, without limiting cause edges', () => {
    const root = new AggregateError([], 'root')
    const first = new AggregateError(Array(600).fill(root), 'first group')
    Object.defineProperty(first.errors, '0', {
      get() {
        throw new Error('unreadable member')
      },
    })
    let cause = error('Error', 'cause 8')
    for (let index = 7; index >= 0; index--) cause = error('Error', `cause ${index}`, cause)
    const second = new AggregateError([...Array(397).fill(root), cause, error('Error', 'past budget')], 'second group')
    const readLastRootMember = vi.fn(() => error('Error', 'unread root member'))
    root.errors = [first, second]
    Object.defineProperty(root.errors, '2', { get: readLastRootMember })
    const entries = builder.buildFromUnknown(root).$exception_list
    // 1 first-group access + 600 members + 1 second-group access + 398 members.
    expect(entries.map((entry) => entry.value)).toEqual([
      'root',
      'first group',
      'Unknown error',
      'second group',
      ...Array.from({ length: 9 }, (_, index) => `cause ${index}`),
    ])
    expect(readLastRootMember).not.toHaveBeenCalled()
    entries.forEach((entry, index) => {
      expect(entry.mechanism?.exception_id).toBe(index)
      if (index > 0) {
        expect(entry.mechanism).toEqual({
          type: 'chained',
          source: index > 4 ? 'cause' : 'member',
          synthetic: index === 2,
          exception_id: index,
          parent_id: index === 1 || index === 3 ? 0 : index - 1,
        })
      }
    })
  })
})
