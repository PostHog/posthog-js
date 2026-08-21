import type { CaptureLogOptions, LogSeverityLevel } from '@posthog/types'
import type { LogSdkContext } from './types'
import { buildOtlpLogRecord, buildOtlpLogsPayload, getOtlpSeverityNumber, getOtlpSeverityText } from './logs-utils'

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

    // `String()` throws on these, and buildOtlpLogRecord is called straight from
    // captureLog — beforeSend can also hand back any body.
    it('marks a body that cannot be coerced to a string', () => {
      const throwing = {
        toString() {
          throw new Error('boom')
        },
      } as unknown as string
      expect(() => buildOtlpLogRecord({ body: throwing }, {})).not.toThrow()
      expect(buildOtlpLogRecord({ body: throwing }, {}).body).toEqual({ stringValue: '[Unserializable]' })
      expect(buildOtlpLogRecord({ body: Object.create(null) }, {}).body).toEqual({
        stringValue: '[Unserializable]',
      })
    })

    it('keeps the record when the attributes object itself cannot be read', () => {
      const revocable = Proxy.revocable({ a: 1 }, {})
      revocable.revoke()

      expect(buildOtlpLogRecord({ body: 'x', attributes: revocable.proxy }, {}).body).toEqual({ stringValue: 'x' })
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
