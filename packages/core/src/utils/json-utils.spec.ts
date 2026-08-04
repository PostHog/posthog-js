import { toJsonSafeValue } from './json-utils'

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
    const serializableToJSON = jest.fn(() => ({ count: BigInt(2) }))
    const serializable = Object.create({ toJSON: serializableToJSON })
    const throwingToJSON = jest.fn(() => {
      throw new Error('cannot serialize')
    })
    const selfReturningValue: { toJSON: () => unknown } = {
      toJSON: () => selfReturningValue,
    }
    const getTimeOverride = jest.fn(() => 0)
    const toISOStringOverride = jest.fn(() => BigInt(2))
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
    const getOwnPropertyDescriptor = jest.fn((object: object, key: string | symbol) =>
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
