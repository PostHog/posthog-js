import type { CaptureLogOptions, LogAttributeValue, LogSeverityLevel } from '@posthog/types'
import type { LogSdkContext } from './types'
import {
  buildOtlpLogRecord,
  buildOtlpLogsPayload,
  getOtlpSeverityNumber,
  getOtlpSeverityText,
  toOtlpAnyValue,
  toOtlpKeyValueList,
} from './logs-utils'

const browserSdkContext: LogSdkContext = {
  distinctId: 'user-123',
  sessionId: 'session-456',
  windowId: 'window-789',
  sessionStartTimestamp: 1672567200000,
  lastActivityTimestamp: 1672569000000,
  currentUrl: 'https://example.com/page',
  activeFeatureFlags: ['flag-a', 'flag-b'],
}

const mobileSdkContext: LogSdkContext = {
  distinctId: 'user-123',
  sessionId: 'session-456',
  screenName: 'Home',
  appState: 'foreground',
  activeFeatureFlags: ['flag-a', 'flag-b'],
}

const minimalSdkContext: LogSdkContext = {}

describe('logs-utils', () => {
  describe('getOtlpSeverityText', () => {
    it.each([
      ['trace', 'TRACE'],
      ['debug', 'DEBUG'],
      ['info', 'INFO'],
      ['warn', 'WARN'],
      ['error', 'ERROR'],
      ['fatal', 'FATAL'],
    ] as [LogSeverityLevel, string][])('maps %s to %s', (level, expected) => {
      expect(getOtlpSeverityText(level)).toBe(expected)
    })

    it('falls back to INFO for unknown levels', () => {
      expect(getOtlpSeverityText('bogus' as LogSeverityLevel)).toBe('INFO')
    })
  })

  describe('getOtlpSeverityNumber', () => {
    it.each([
      ['trace', 1],
      ['debug', 5],
      ['info', 9],
      ['warn', 13],
      ['error', 17],
      ['fatal', 21],
    ] as [LogSeverityLevel, number][])('maps %s to %d', (level, expected) => {
      expect(getOtlpSeverityNumber(level)).toBe(expected)
    })

    it('falls back to 9 (INFO) for unknown levels', () => {
      expect(getOtlpSeverityNumber('bogus' as LogSeverityLevel)).toBe(9)
    })
  })

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

  describe('buildOtlpLogRecord attribute reads', () => {
    // Reading `options.attributes` happens before the encoder's per-key guard.
    it('marks an attribute whose getter throws without dropping the record', () => {
      const attributes = {
        ok: 1,
        get bad(): number {
          throw new Error('disposed store')
        },
      }
      const record = buildOtlpLogRecord({ body: 'x', attributes }, {})
      expect(record.attributes).toContainEqual({ key: 'ok', value: { intValue: '1' } })
      expect(record.attributes).toContainEqual({ key: 'bad', value: { stringValue: '[Unserializable]' } })
    })

    // Plain assignment hits the prototype setter and the attribute vanishes.
    it('keeps an attribute literally named __proto__', () => {
      const attributes = JSON.parse('{"__proto__": {"a": 1}, "normal": "n"}')
      const record = buildOtlpLogRecord({ body: 'x', attributes }, {})
      expect(record.attributes.map((a) => a.key)).toContain('__proto__')
    })

    it('coerces a non-string body', () => {
      // A non-string stringValue is refused for the whole request.
      const record = buildOtlpLogRecord({ body: 12345 as unknown as string }, {})
      expect(record.body).toEqual({ stringValue: '12345' })
    })

    it('keeps the record when the attributes object itself cannot be read', () => {
      const revocable = Proxy.revocable({ a: 1 }, {})
      revocable.revoke()

      expect(buildOtlpLogRecord({ body: 'x', attributes: revocable.proxy }, {}).body).toEqual({ stringValue: 'x' })
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

  describe('buildOtlpLogRecord', () => {
    it('builds a minimal log record', () => {
      const record = buildOtlpLogRecord({ body: 'hello world' }, minimalSdkContext)

      expect(record.body).toEqual({ stringValue: 'hello world' })
      expect(record.severityText).toBe('INFO')
      expect(record.severityNumber).toBe(9)
      expect(record.timeUnixNano).toBeDefined()
      expect(record.observedTimeUnixNano).toBeDefined()
      expect(record.observedTimeUnixNano).toBe(record.timeUnixNano)
    })

    it('maps severity levels correctly', () => {
      const record = buildOtlpLogRecord({ body: 'test', level: 'error' }, minimalSdkContext)
      expect(record.severityText).toBe('ERROR')
      expect(record.severityNumber).toBe(17)
    })

    it('falls back to INFO for unknown severity', () => {
      const record = buildOtlpLogRecord({ body: 'test', level: 'bogus' as LogSeverityLevel }, minimalSdkContext)
      expect(record.severityText).toBe('INFO')
      expect(record.severityNumber).toBe(9)
    })

    it('auto-populates browser SDK context (currentUrl → url.full)', () => {
      const record = buildOtlpLogRecord({ body: 'test' }, browserSdkContext)
      const attrs = Object.fromEntries(record.attributes.map((a) => [a.key, a.value]))
      expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'user-123' })
      expect(attrs['sessionId']).toEqual({ stringValue: 'session-456' })
      expect(attrs['window.id']).toEqual({ stringValue: 'window-789' })
      expect(attrs['sessionStartTimestamp']).toEqual({ stringValue: '1672567200000' })
      expect(attrs['lastActivityTimestamp']).toEqual({ stringValue: '1672569000000' })
      expect(attrs['url.full']).toEqual({ stringValue: 'https://example.com/page' })
      expect(attrs['feature_flags']).toEqual({
        arrayValue: { values: [{ stringValue: 'flag-a' }, { stringValue: 'flag-b' }] },
      })
      // browser context shouldn't leak mobile-only attrs
      expect(attrs['screen.name']).toBeUndefined()
      expect(attrs['app.state']).toBeUndefined()
    })

    it.each(['window.id', 'sessionStartTimestamp', 'lastActivityTimestamp'])(
      'omits %s when absent from the SDK context',
      (attribute) => {
        const record = buildOtlpLogRecord({ body: 'test' }, minimalSdkContext)
        expect(record.attributes.map((a) => a.key)).not.toContain(attribute)
      }
    )

    it('preserves a sessionStartTimestamp of 0 (epoch)', () => {
      const record = buildOtlpLogRecord({ body: 'test' }, { ...minimalSdkContext, sessionStartTimestamp: 0 })
      const attrs = Object.fromEntries(record.attributes.map((a) => [a.key, a.value]))
      expect(attrs['sessionStartTimestamp']).toEqual({ stringValue: '0' })
    })

    it('auto-populates mobile SDK context (screenName + appState)', () => {
      const record = buildOtlpLogRecord({ body: 'test' }, mobileSdkContext)
      const attrs = Object.fromEntries(record.attributes.map((a) => [a.key, a.value]))
      expect(attrs['screen.name']).toEqual({ stringValue: 'Home' })
      expect(attrs['app.state']).toEqual({ stringValue: 'foreground' })
      // mobile context shouldn't leak browser-only attrs
      expect(attrs['url.full']).toBeUndefined()
    })

    it('user attributes override auto-populated ones', () => {
      const record = buildOtlpLogRecord(
        { body: 'test', attributes: { posthogDistinctId: 'custom-id' } },
        browserSdkContext
      )
      const attrs = Object.fromEntries(record.attributes.map((a) => [a.key, a.value]))
      expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'custom-id' })
    })

    it('includes trace context when provided', () => {
      const options: CaptureLogOptions = {
        body: 'test',
        trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
        span_id: '00f067aa0ba902b7',
        trace_flags: 1,
      }
      const record = buildOtlpLogRecord(options, minimalSdkContext)
      expect(record.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
      expect(record.spanId).toBe('00f067aa0ba902b7')
      expect(record.flags).toBe(1)
    })

    it('omits trace context when not provided', () => {
      const record = buildOtlpLogRecord({ body: 'test' }, minimalSdkContext)
      expect(record.traceId).toBeUndefined()
      expect(record.spanId).toBeUndefined()
      expect(record.flags).toBeUndefined()
    })

    it('preserves trace_flags === 0', () => {
      // Easy to lose with a falsy check; trace_flags is a numeric bitfield
      // where 0 is a valid value (means "not sampled").
      const record = buildOtlpLogRecord({ body: 'test', trace_flags: 0 }, minimalSdkContext)
      expect(record.flags).toBe(0)
    })

    it('does not include feature_flags when the array is empty', () => {
      const record = buildOtlpLogRecord({ body: 'test' }, { ...minimalSdkContext, activeFeatureFlags: [] })
      expect(record.attributes.map((a) => a.key)).not.toContain('feature_flags')
    })
  })

  describe('buildOtlpLogsPayload', () => {
    it('wraps log records in the OTLP envelope with scope name and version', () => {
      const record = buildOtlpLogRecord({ body: 'test' }, minimalSdkContext)
      const payload = buildOtlpLogsPayload([record], { 'service.name': 'my-app' }, 'posthog-js', '1.371.0')

      expect(payload.resourceLogs).toHaveLength(1)
      expect(payload.resourceLogs[0].resource.attributes).toEqual([
        { key: 'service.name', value: { stringValue: 'my-app' } },
      ])
      expect(payload.resourceLogs[0].scopeLogs).toHaveLength(1)
      expect(payload.resourceLogs[0].scopeLogs[0].scope).toEqual({
        name: 'posthog-js',
        version: '1.371.0',
      })
      expect(payload.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1)
    })

    it('includes multiple log records', () => {
      const records = [
        buildOtlpLogRecord({ body: 'log 1' }, minimalSdkContext),
        buildOtlpLogRecord({ body: 'log 2', level: 'error' }, minimalSdkContext),
      ]
      const payload = buildOtlpLogsPayload(records, { 'service.name': 'x' }, 'lib', '1.0.0')
      expect(payload.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2)
    })
  })
})
