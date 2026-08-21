import type { LogAttributeValue } from '@posthog/types'
import { toOtlpAnyValue, toOtlpKeyValueList } from './otlp-any-value'

describe('otlp-any-value', () => {
  describe('toOtlpAnyValue', () => {
    it('converts strings', () => {
      expect(toOtlpAnyValue('hello')).toEqual({ stringValue: 'hello' })
    })

    it('converts integers to decimal strings', () => {
      expect(toOtlpAnyValue(42)).toEqual({ intValue: '42' })
      expect(toOtlpAnyValue(0)).toEqual({ intValue: '0' })
      expect(toOtlpAnyValue(-7)).toEqual({ intValue: '-7' })
    })

    // Spec: outside int64 it is a stringValue, never an intValue.
    it('converts integers outside int64 to stringValue', () => {
      expect(toOtlpAnyValue(2 ** 63)).toEqual({ stringValue: '9223372036854775808' })
      expect(toOtlpAnyValue(-(2 ** 64))).toEqual({ stringValue: '-18446744073709551616' })
      expect(toOtlpAnyValue(1e21)).toEqual({ stringValue: '1000000000000000000000' })
    })

    it('logs a debug line when an integer falls outside int64', () => {
      const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), critical: jest.fn() }
      toOtlpAnyValue(2 ** 63, logger as any)
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('outside the int64 range'))
    })

    it('keeps int64 min as intValue', () => {
      // In range, but `String` renders it 192 below int64 min, so the decimal
      // has to come from BigInt.
      expect(toOtlpAnyValue(-(2 ** 63))).toEqual({ intValue: '-9223372036854775808' })
    })

    it('keeps large in-range integers exact', () => {
      expect(toOtlpAnyValue(Number.MAX_SAFE_INTEGER)).toEqual({ intValue: '9007199254740991' })
      // The largest double below 2^63 — no double exists between the two.
      expect(toOtlpAnyValue(9223372036854774784)).toEqual({ intValue: '9223372036854774784' })
      expect(toOtlpAnyValue(2 ** 62)).toEqual({ intValue: '4611686018427387904' })
    })

    it('converts a bigint inside int64 to a stringified intValue', () => {
      // Span attributes accept bigint; a log attribute reaching here is typed
      // out but still encodes correctly.
      expect(toOtlpAnyValue(9007199254740993n as unknown as LogAttributeValue)).toEqual({
        intValue: '9007199254740993',
      })
    })

    it('converts a bigint beyond int64 to a string, with a warning', () => {
      const logger = { debug: jest.fn() }
      expect(toOtlpAnyValue(18446744073709551616n as unknown as LogAttributeValue, logger as any)).toEqual({
        stringValue: '18446744073709551616',
      })
      expect(logger.debug).toHaveBeenCalled()
    })

    it('converts floats to doubleValue', () => {
      expect(toOtlpAnyValue(3.14)).toEqual({ doubleValue: 3.14 })
    })

    it('converts booleans', () => {
      expect(toOtlpAnyValue(true)).toEqual({ boolValue: true })
      expect(toOtlpAnyValue(false)).toEqual({ boolValue: false })
    })

    // JSON has no representation for non-finite floats; without explicit
    // handling, JSON.stringify silently turns them into `null` and the value
    // is lost server-side.
    it('converts NaN to stringValue', () => {
      expect(toOtlpAnyValue(NaN)).toEqual({ stringValue: 'NaN' })
    })

    it('converts +Infinity to stringValue', () => {
      expect(toOtlpAnyValue(Infinity)).toEqual({ stringValue: 'Infinity' })
    })

    it('converts -Infinity to stringValue', () => {
      expect(toOtlpAnyValue(-Infinity)).toEqual({ stringValue: '-Infinity' })
    })

    it('converts arrays of strings to arrayValue', () => {
      expect(toOtlpAnyValue(['a', 'b'])).toEqual({
        arrayValue: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] },
      })
    })

    it('converts mixed primitive arrays recursively', () => {
      expect(toOtlpAnyValue([1, 'x', true])).toEqual({
        arrayValue: {
          values: [{ intValue: '1' }, { stringValue: 'x' }, { boolValue: true }],
        },
      })
    })

    it('converts plain objects to kvlistValue', () => {
      expect(toOtlpAnyValue({ a: 1, b: 'two' })).toEqual({
        kvlistValue: {
          values: [
            { key: 'a', value: { intValue: '1' } },
            { key: 'b', value: { stringValue: 'two' } },
          ],
        },
      })
    })

    it('converts nested objects recursively', () => {
      expect(toOtlpAnyValue({ outer: { inner: 1 } })).toEqual({
        kvlistValue: {
          values: [
            {
              key: 'outer',
              value: { kvlistValue: { values: [{ key: 'inner', value: { intValue: '1' } }] } },
            },
          ],
        },
      })
    })

    it('drops null and undefined keys inside objects', () => {
      expect(toOtlpAnyValue({ kept: 1, gone: null, alsoGone: undefined })).toEqual({
        kvlistValue: { values: [{ key: 'kept', value: { intValue: '1' } }] },
      })
    })

    // Not in LogAttributeValue, but reachable at runtime from untyped callers.
    it('encodes Dates as ISO strings', () => {
      expect(toOtlpAnyValue(new Date('2026-08-20T10:00:00.000Z') as unknown as LogAttributeValue)).toEqual({
        stringValue: '2026-08-20T10:00:00.000Z',
      })
    })

    it('marks circular references instead of recursing', () => {
      const cyclic: Record<string, unknown> = { name: 'root' }
      cyclic.self = cyclic
      expect(toOtlpAnyValue(cyclic)).toEqual({
        kvlistValue: {
          values: [
            { key: 'name', value: { stringValue: 'root' } },
            { key: 'self', value: { stringValue: '[Circular]' } },
          ],
        },
      })
    })

    // An escaping error would surface in the caller's application code.
    it('does not throw on an object nested past the depth cap', () => {
      let deep: Record<string, unknown> = { end: true }
      for (let i = 0; i < 25000; i++) {
        deep = { next: deep }
      }
      expect(() => toOtlpAnyValue(deep)).not.toThrow()
    })

    it('truncates at exactly 20 levels instead of recursing', () => {
      let deep: Record<string, unknown> = { end: true }
      for (let i = 0; i < 25; i++) {
        deep = { next: deep }
      }
      const encoded = JSON.stringify(toOtlpAnyValue(deep))
      expect(encoded).toContain('[Truncated]')
      expect(encoded.split('"next"').length - 1).toBe(20)
    })

    it('marks a throwing getter without losing the rest of the object', () => {
      const attrs = {
        ok: 1,
        get bad(): number {
          throw new Error('getter blew up')
        },
      }
      expect(() => toOtlpKeyValueList(attrs)).not.toThrow()
      expect(toOtlpKeyValueList(attrs)).toEqual([
        { key: 'ok', value: { intValue: '1' } },
        { key: 'bad', value: { stringValue: '[Unserializable]' } },
      ])
    })

    // for...in walks the prototype chain once own keys are exhausted.
    it('ignores inherited enumerable properties', () => {
      const inherited: Record<string, unknown> = Object.create({ fromPrototype: 'leaked' })
      inherited.own = 1
      expect(toOtlpAnyValue(inherited)).toEqual({
        kvlistValue: { values: [{ key: 'own', value: { intValue: '1' } }] },
      })
    })

    // `String(fn)` would put the function's source text on the wire.
    it('marks function and symbol values instead of stringifying them', () => {
      expect(toOtlpAnyValue({ handler: () => 1, retries: 2 } as unknown as LogAttributeValue)).toEqual({
        kvlistValue: {
          values: [
            { key: 'handler', value: { stringValue: '[Function]' } },
            { key: 'retries', value: { intValue: '2' } },
          ],
        },
      })
      expect(toOtlpAnyValue({ sym: Symbol('x') } as unknown as LogAttributeValue)).toEqual({
        kvlistValue: { values: [{ key: 'sym', value: { stringValue: 'Symbol(x)' } }] },
      })
    })

    // dayjs, Decimal, ORM documents.
    it('honours toJSON', () => {
      const wrapped = { toJSON: () => ({ amount: 5 }) }
      expect(toOtlpAnyValue(wrapped as unknown as LogAttributeValue)).toEqual({
        kvlistValue: { values: [{ key: 'amount', value: { intValue: '5' } }] },
      })
    })

    it('falls back to the plain walk when toJSON throws', () => {
      const wrapped = {
        kept: 1,
        toJSON: () => {
          throw new Error('nope')
        },
      }
      expect(toOtlpAnyValue(wrapped as unknown as LogAttributeValue)).toEqual({
        kvlistValue: {
          values: [
            { key: 'kept', value: { intValue: '1' } },
            { key: 'toJSON', value: { stringValue: '[Function]' } },
          ],
        },
      })
    })

    // A toJSON returning its own object is a cycle like any other.
    it('marks a cycle that runs through toJSON', () => {
      const cyclic: Record<string, unknown> = {}
      cyclic.toJSON = () => ({ inner: cyclic })
      expect(toOtlpAnyValue(cyclic)).toEqual({
        kvlistValue: { values: [{ key: 'inner', value: { stringValue: '[Circular]' } }] },
      })
    })

    // Both `null` and `{}` here are rejected for the whole request; iOS and
    // Android drop them too.
    it('drops holes and nullish elements from arrays', () => {
      // eslint-disable-next-line no-sparse-arrays
      expect(toOtlpAnyValue([1, , 3])).toEqual({
        arrayValue: { values: [{ intValue: '1' }, { intValue: '3' }] },
      })
      expect(toOtlpAnyValue([1, null, undefined, 3])).toEqual({
        arrayValue: { values: [{ intValue: '1' }, { intValue: '3' }] },
      })
    })

    it('stops encoding array items once the node budget is spent', () => {
      const row: Record<string, number> = {}
      for (let i = 0; i < 20; i++) {
        row[`k${i}`] = i
      }
      const wide = Array.from({ length: 1000 }, () => ({ ...row }))
      const values = toOtlpAnyValue(wide).arrayValue!.values
      expect(values[values.length - 1]).toEqual({ stringValue: '[Truncated]' })
      // One marker, not one per unencodable item.
      expect(values.filter((v) => v.stringValue === '[Truncated]')).toHaveLength(1)
    })

    it('caps a shared object graph instead of expanding it', () => {
      let graph: Record<string, unknown> = { leaf: true }
      for (let i = 0; i < 20; i++) {
        graph = { a: graph, b: graph }
      }
      const encoded = JSON.stringify(toOtlpAnyValue(graph))
      expect(encoded).toContain('[Truncated]')
      expect(encoded.length).toBeLessThan(1_000_000)
    })

    it('caps a very wide object without inventing an attribute key', () => {
      const wide: Record<string, number> = {}
      for (let i = 0; i < 5000; i++) {
        wide[`k${i}`] = i
      }
      const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), critical: jest.fn() }
      const values = toOtlpAnyValue(wide, logger as any).kvlistValue!.values
      expect(values).toHaveLength(1000)
      expect(values.every((v) => v.key.startsWith('k'))).toBe(true)
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('truncated'))
    })

    // Why the encoder does not delegate to toJsonSafeValue: that maps them to null.
    it('keeps non-finite floats as strings inside nested objects', () => {
      expect(toOtlpAnyValue({ nested: { ratio: NaN } })).toEqual({
        kvlistValue: {
          values: [
            {
              key: 'nested',
              value: { kvlistValue: { values: [{ key: 'ratio', value: { stringValue: 'NaN' } }] } },
            },
          ],
        },
      })
    })

    // A lone surrogate survives JSON.stringify as a \uD800 escape, which the
    // server rejects for the whole request.
    it('replaces unpaired surrogates in values and keys', () => {
      expect(toOtlpAnyValue('ok\ud83d')).toEqual({ stringValue: 'ok\ufffd' })
      expect(toOtlpAnyValue({ nested: 'ok\ud83d' })).toEqual({
        kvlistValue: { values: [{ key: 'nested', value: { stringValue: 'ok\ufffd' } }] },
      })
      expect(toOtlpKeyValueList({ 'key\ud83d': 1 })).toEqual([{ key: 'key\ufffd', value: { intValue: '1' } }])
    })

    it('encodes empty containers with an explicit values array', () => {
      expect(toOtlpAnyValue({})).toEqual({ kvlistValue: { values: [] } })
      expect(toOtlpAnyValue([])).toEqual({ arrayValue: { values: [] } })
    })

    it('keeps a Date whose toISOString is overridden out of the wire format', () => {
      const broken = new Date('2026-08-20T10:00:00.000Z')

      ;(broken as any).toISOString = () => ({})
      expect(typeof toOtlpAnyValue(broken as unknown as LogAttributeValue).stringValue).toBe('string')
    })

    it('encodes sibling references to one object twice, not as circular', () => {
      const shared = { id: 1 }
      expect(toOtlpAnyValue({ a: shared, b: shared })).toEqual({
        kvlistValue: {
          values: [
            { key: 'a', value: { kvlistValue: { values: [{ key: 'id', value: { intValue: '1' } }] } } },
            { key: 'b', value: { kvlistValue: { values: [{ key: 'id', value: { intValue: '1' } }] } } },
          ],
        },
      })
    })
  })

  describe('toOtlpKeyValueList', () => {
    it('converts a record to key-value list', () => {
      expect(
        toOtlpKeyValueList({
          name: 'test',
          count: 5,
          active: true,
        })
      ).toEqual([
        { key: 'name', value: { stringValue: 'test' } },
        { key: 'count', value: { intValue: '5' } },
        { key: 'active', value: { boolValue: true } },
      ])
    })

    it('handles empty record', () => {
      expect(toOtlpKeyValueList({})).toEqual([])
    })

    it('skips null and undefined values', () => {
      expect(
        toOtlpKeyValueList({
          kept: 'yes',
          nullish: null,
          missing: undefined,
        })
      ).toEqual([{ key: 'kept', value: { stringValue: 'yes' } }])
    })
  })
})
