import {
    getOtlpSeverityText,
    getOtlpSeverityNumber,
    toOtlpAnyValue,
    toOtlpKeyValueList,
    buildOtlpLogRecord,
    buildOtlpLogsPayload,
    type LogSdkContext,
} from '../logs-utils'
import type { CaptureLogOptions, LogSeverityLevel } from '../types'

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
    })

    describe('toOtlpAnyValue', () => {
        it('converts strings', () => {
            expect(toOtlpAnyValue('hello')).toEqual({ stringValue: 'hello' })
        })

        it('converts integers', () => {
            expect(toOtlpAnyValue(42)).toEqual({ intValue: 42 })
        })

        it('converts floats to doubleValue', () => {
            expect(toOtlpAnyValue(3.14)).toEqual({ doubleValue: 3.14 })
        })

        it('converts booleans', () => {
            expect(toOtlpAnyValue(true)).toEqual({ boolValue: true })
            expect(toOtlpAnyValue(false)).toEqual({ boolValue: false })
        })

        it('converts arrays to OTLP arrayValue', () => {
            expect(toOtlpAnyValue(['a', 'b'])).toEqual({
                arrayValue: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] },
            })
        })

        it('converts mixed arrays recursively', () => {
            expect(toOtlpAnyValue([1, 'x', true])).toEqual({
                arrayValue: {
                    values: [{ intValue: 1 }, { stringValue: 'x' }, { boolValue: true }],
                },
            })
        })

        it('JSON-stringifies plain objects', () => {
            expect(toOtlpAnyValue({ a: 1, b: 'two' })).toEqual({
                stringValue: '{"a":1,"b":"two"}',
            })
        })
    })

    describe('toOtlpKeyValueList filtering', () => {
        it('filters out null and undefined values', () => {
            const result = toOtlpKeyValueList({
                kept: 'yes',
                nullish: null,
                missing: undefined,
            })
            expect(result).toEqual([{ key: 'kept', value: { stringValue: 'yes' } }])
        })
    })

    describe('toOtlpKeyValueList', () => {
        it('converts a record to key-value list', () => {
            const result = toOtlpKeyValueList({
                name: 'test',
                count: 5,
                active: true,
            })
            expect(result).toEqual([
                { key: 'name', value: { stringValue: 'test' } },
                { key: 'count', value: { intValue: 5 } },
                { key: 'active', value: { boolValue: true } },
            ])
        })

        it('handles empty record', () => {
            expect(toOtlpKeyValueList({})).toEqual([])
        })
    })

    describe('buildOtlpLogRecord', () => {
        const baseSdkContext: LogSdkContext = {
            lib: 'posthog-js',
            distinctId: 'user-123',
            sessionId: 'session-456',
            currentUrl: 'https://example.com/page',
            activeFeatureFlags: ['flag-a', 'flag-b'],
        }

        it('builds a minimal log record', () => {
            const options: CaptureLogOptions = { body: 'hello world' }
            const record = buildOtlpLogRecord(options, { lib: 'posthog-js' })

            expect(record.body).toEqual({ stringValue: 'hello world' })
            expect(record.severityText).toBe('INFO')
            expect(record.severityNumber).toBe(9)
            expect(record.timeUnixNano).toBeDefined()
            expect(record.observedTimeUnixNano).toBeDefined()
        })

        it('maps severity levels correctly', () => {
            const options: CaptureLogOptions = { body: 'test', level: 'error' }
            const record = buildOtlpLogRecord(options, { lib: 'posthog-js' })

            expect(record.severityText).toBe('ERROR')
            expect(record.severityNumber).toBe(17)
        })

        it('auto-populates SDK context into attributes', () => {
            const options: CaptureLogOptions = { body: 'test' }
            const record = buildOtlpLogRecord(options, baseSdkContext)

            const attrs = Object.fromEntries(record.attributes.map((a) => [a.key, a.value]))
            expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'user-123' })
            expect(attrs['sessionId']).toEqual({ stringValue: 'session-456' })
            expect(attrs['url.full']).toEqual({ stringValue: 'https://example.com/page' })
            expect(attrs['feature_flags']).toEqual({
                arrayValue: { values: [{ stringValue: 'flag-a' }, { stringValue: 'flag-b' }] },
            })
        })

        it('user attributes override auto-populated ones', () => {
            const options: CaptureLogOptions = {
                body: 'test',
                attributes: { posthogDistinctId: 'custom-id' },
            }
            const record = buildOtlpLogRecord(options, baseSdkContext)

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
            const record = buildOtlpLogRecord(options, { lib: 'posthog-js' })

            expect(record.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
            expect(record.spanId).toBe('00f067aa0ba902b7')
            expect(record.flags).toBe(1)
        })

        it('omits trace context when not provided', () => {
            const options: CaptureLogOptions = { body: 'test' }
            const record = buildOtlpLogRecord(options, { lib: 'posthog-js' })

            expect(record.traceId).toBeUndefined()
            expect(record.spanId).toBeUndefined()
            expect(record.flags).toBeUndefined()
        })

        it('does not include empty feature flags', () => {
            const options: CaptureLogOptions = { body: 'test' }
            const context: LogSdkContext = { lib: 'posthog-js', activeFeatureFlags: [] }
            const record = buildOtlpLogRecord(options, context)

            const keys = record.attributes.map((a) => a.key)
            expect(keys).not.toContain('feature_flags')
        })
    })

    describe('buildOtlpLogsPayload', () => {
        it('wraps log records in the OTLP envelope', () => {
            const record = buildOtlpLogRecord({ body: 'test' }, { lib: 'posthog-js' })
            const payload = buildOtlpLogsPayload([record], { 'service.name': 'my-app' })

            expect(payload.resourceLogs).toHaveLength(1)
            expect(payload.resourceLogs[0].resource.attributes).toEqual([
                { key: 'service.name', value: { stringValue: 'my-app' } },
            ])
            expect(payload.resourceLogs[0].scopeLogs).toHaveLength(1)
            expect(payload.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1)
        })

        it('includes multiple log records', () => {
            const records = [
                buildOtlpLogRecord({ body: 'log 1' }, { lib: 'posthog-js' }),
                buildOtlpLogRecord({ body: 'log 2', level: 'error' }, { lib: 'posthog-js' }),
            ]
            const payload = buildOtlpLogsPayload(records, { 'service.name': 'posthog-js' })

            expect(payload.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2)
        })
    })
})
