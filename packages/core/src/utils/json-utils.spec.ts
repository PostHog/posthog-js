import { MAX_JSON_SAFE_VALUE_DEPTH, toJsonSafeValue, withoutNullMembers } from './json-utils'

describe('toJsonSafeValue', () => {
  it('converts circular and unsupported values while preserving shared references', () => {
    const shared = { id: 1 }
    const value: Record<string, unknown> = {
      count: BigInt(42),
      callback: () => undefined,
      symbol: Symbol('test'),
      invalidNumber: Number.NaN,
      loneSurrogate: '\ud800',
      validSurrogatePair: '😀',
      first: shared,
      second: shared,
    }
    value.self = value

    expect(toJsonSafeValue(value)).toEqual({
      count: '42',
      callback: '[Function]',
      symbol: 'Symbol(test)',
      invalidNumber: null,
      loneSurrogate: '�',
      validSurrogatePair: '😀',
      first: { id: 1 },
      second: { id: 1 },
      self: '[Circular]',
    })
  })

  it('sanitizes toJSON results and falls back when toJSON throws', () => {
    const serializableToJSON = vi.fn(() => ({ count: BigInt(2) }))
    const serializable = Object.create({ toJSON: serializableToJSON })
    const throwingToJSON = vi.fn(() => {
      throw new Error('cannot serialize')
    })
    const selfReturningValue: { toJSON: () => unknown } = {
      toJSON: () => selfReturningValue,
    }
    const getTimeOverride = vi.fn(() => 0)
    const toISOStringOverride = vi.fn(() => BigInt(2))
    const date = new Date('2025-01-02T03:04:05.000Z')
    Object.defineProperties(date, {
      getTime: { value: getTimeOverride },
      toISOString: { value: toISOStringOverride },
    })

    expect(
      toJsonSafeValue({
        serializable,
        throwing: { value: 'kept', toJSON: throwingToJSON },
        selfReturningValue,
        date,
      })
    ).toEqual({
      serializable: { count: '2' },
      throwing: { value: 'kept', toJSON: '[Function]' },
      selfReturningValue: '[Circular]',
      date: '2025-01-02T03:04:05.000Z',
    })
    expect(serializableToJSON).toHaveBeenCalledTimes(1)
    expect(throwingToJSON).toHaveBeenCalledTimes(1)
    expect(getTimeOverride).not.toHaveBeenCalled()
    expect(toISOStringOverride).not.toHaveBeenCalled()
  })

  it('stops before traversing inherited enumerable properties', () => {
    const prototype = Object.fromEntries(Array.from({ length: 2_000 }, (_, index) => [`key-${index}`, index]))
    const target = Object.assign(Object.create(prototype), { own: 'kept' })
    const getOwnPropertyDescriptor = vi.fn((object: object, key: string | symbol) =>
      Object.getOwnPropertyDescriptor(object, key)
    )
    const value = new Proxy(target, { getOwnPropertyDescriptor })

    expect(toJsonSafeValue(value)).toEqual({ own: 'kept' })
    expect(getOwnPropertyDescriptor.mock.calls.length).toBeLessThan(10)
  })

  it('returns a fallback for values that throw during traversal', () => {
    const value = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('cannot inspect')
        },
      }
    )

    expect(toJsonSafeValue(value)).toBe('[Unserializable]')
  })

  it('bounds deeply nested, oversized, and node-heavy values', () => {
    const deepValue: Record<string, unknown> = {}
    let cursor = deepValue
    for (let depth = 0; depth < 100; depth++) {
      const child: Record<string, unknown> = {}
      cursor.child = child
      cursor = child
    }
    const oversizedArray = Array.from({ length: 2_000 }, (_, index) => index)
    const oversizedObject = Object.fromEntries(Array.from({ length: 2_000 }, (_, index) => [`key-${index}`, index]))
    const nodeHeavyValue = Array.from({ length: 1_000 }, () => Array.from({ length: 20 }, () => true))

    expect(JSON.stringify(toJsonSafeValue(deepValue))).toContain('[Truncated]')
    expect(toJsonSafeValue(oversizedArray)).toEqual([...oversizedArray.slice(0, 1_000), '[Truncated]'])

    const safeObject = toJsonSafeValue(oversizedObject) as Record<string, unknown>
    expect(Object.keys(safeObject)).toHaveLength(1_001)
    expect(safeObject['[Truncated]']).toBe('Additional properties omitted')

    const safeNodeHeavyValue = toJsonSafeValue(nodeHeavyValue) as unknown[]
    expect(safeNodeHeavyValue).toHaveLength(478)
    expect(safeNodeHeavyValue.at(-1)).toBe('[Truncated]')
  })
})

describe('withoutNullMembers', () => {
  it('removes null and undefined members recursively and keeps array positions', () => {
    const dirty = { a: null, b: undefined, nested: { drop: null }, items: [null, { drop: null, keep: 0 }] }
    expect(withoutNullMembers(dirty)).toEqual({ nested: {}, items: [null, { keep: 0 }] })
    expect(dirty.nested).toEqual({ drop: null })
  })

  it('returns the input when nothing changes', () => {
    const clean = { a: 1, nested: { b: 'ok' }, items: [1, null, { c: 2 }] }
    expect(withoutNullMembers(clean)).toBe(clean)
  })

  it('can be passed directly as a mapper callback', () => {
    const items = [
      { a: 1, b: null },
      { c: undefined, d: 'ok' },
    ]
    expect(items.map(withoutNullMembers)).toEqual([{ a: 1 }, { d: 'ok' }])
  })

  it('cleans null-prototype objects and leaves cycles and non-plain objects as they are', () => {
    expect(withoutNullMembers(Object.assign(Object.create(null), { keep: 1, drop: null }))).toEqual({ keep: 1 })

    const cyclic: Record<string, unknown> = { drop: null }
    cyclic.self = cyclic
    const cleaned = withoutNullMembers(cyclic)
    expect(cleaned).not.toHaveProperty('drop')
    expect(cleaned.self).toBe(cyclic)

    const date = new Date('2025-01-01T00:00:00.000Z')
    expect(withoutNullMembers({ date, drop: null })).toEqual({ date })
  })

  it('leaves members nested at the depth limit as they are', () => {
    const deepest = { drop: null }
    let value: Record<string, unknown> = deepest
    for (let i = 0; i < MAX_JSON_SAFE_VALUE_DEPTH; i++) {
      value = { child: value }
    }
    let cleaned = withoutNullMembers(value)
    for (let i = 0; i < MAX_JSON_SAFE_VALUE_DEPTH; i++) {
      cleaned = cleaned.child as Record<string, unknown>
    }
    expect(cleaned).toBe(deepest)
  })
})
