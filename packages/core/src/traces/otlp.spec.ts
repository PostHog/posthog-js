import {
  buildOtlpSpan,
  buildOtlpTracesPayload,
  buildTracesResourceAttributes,
  msToUnixNanoString,
  spanKindToOtlp,
} from './otlp'
import type { ResolvedTracesConfig, SpanRecord } from './types'

const record = (overrides: Partial<SpanRecord> = {}): SpanRecord => ({
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
  name: 'checkout',
  kind: 'internal',
  attributes: {},
  events: [],
  startTime: 1_700_000_000_000,
  endTime: 1_700_000_000_080,
  ...overrides,
})

describe('OTLP span encoding', () => {
  describe('msToUnixNanoString', () => {
    it('encodes milliseconds as a nanosecond string', () => {
      expect(msToUnixNanoString(1_700_000_000_000)).toBe('1700000000000000000')
    })

    it('keeps sub-millisecond precision', () => {
      expect(msToUnixNanoString(1_700_000_000_000.5)).toBe('1700000000000500000')
    })

    it('stays exact beyond Number.MAX_SAFE_INTEGER', () => {
      // The whole point of string concatenation over `ms * 1e6`, which would
      // silently lose precision at this magnitude.
      const encoded = msToUnixNanoString(1_700_000_000_123)
      expect(encoded).toBe('1700000000123000000')
      expect(Number(encoded)).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
    })

    it.each([0.9999999, 1.9999999, 999.9999999])(
      'carries a rounded-up fraction into the next millisecond for %p',
      (ms) => {
        // Without the carry the padded fraction gains a seventh digit, producing
        // a malformed timestamp that 400s the whole request. Unreachable from a
        // real clock — float64 quantization at epoch-ms magnitude keeps the
        // fraction well below the carry — but reachable via a caller-supplied
        // `startTime`, which the validity check accepts anywhere in [0, MAX].
        const encoded = msToUnixNanoString(ms)
        expect(encoded).toHaveLength(String(Math.round(ms)).length + 6)
        expect(encoded).toMatch(/^\d+$/)
      }
    )
  })

  describe('spanKindToOtlp', () => {
    it.each([
      ['internal', 1],
      ['server', 2],
      ['client', 3],
      ['producer', 4],
      ['consumer', 5],
    ] as const)('maps %s to %i', (kind, expected) => {
      expect(spanKindToOtlp(kind)).toBe(expected)
    })

    it('defaults to internal', () => {
      expect(spanKindToOtlp(undefined)).toBe(1)
    })
  })

  describe('buildOtlpSpan', () => {
    it('builds the minimal shape', () => {
      expect(buildOtlpSpan(record())).toEqual({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        name: 'checkout',
        kind: 1,
        startTimeUnixNano: '1700000000000000000',
        endTimeUnixNano: '1700000000080000000',
        flags: 1,
      })
    })

    it('omits status when it was never set', () => {
      expect(buildOtlpSpan(record())).not.toHaveProperty('status')
    })

    it('encodes ok and error status codes', () => {
      expect(buildOtlpSpan(record({ status: { code: 'ok' } })).status).toEqual({ code: 1 })
      expect(buildOtlpSpan(record({ status: { code: 'error', message: 'boom' } })).status).toEqual({
        code: 2,
        message: 'boom',
      })
    })

    it('includes parent, tracestate, attributes and events when present', () => {
      const span = buildOtlpSpan(
        record({
          parentSpanId: 'b7ad6b7169203331',
          traceState: 'vendor=abc',
          attributes: { plan: 'pro' },
          events: [{ name: 'cache miss', timestamp: 1_700_000_000_040 }],
        })
      )
      expect(span.parentSpanId).toBe('b7ad6b7169203331')
      expect(span.traceState).toBe('vendor=abc')
      expect(span.attributes).toEqual([{ key: 'plan', value: { stringValue: 'pro' } }])
      expect(span.events).toEqual([{ name: 'cache miss', timeUnixNano: '1700000000040000000' }])
    })

    it('always sets the sampled trace flag', () => {
      expect(buildOtlpSpan(record()).flags).toBe(1)
    })
  })

  describe('buildTracesResourceAttributes', () => {
    const config = (partial: Partial<ResolvedTracesConfig> = {}): ResolvedTracesConfig => ({
      flushIntervalMs: 5000,
      maxExportBatchSize: 512,
      maxQueueSize: 2048,
      maxAttributesPerSpan: 128,
      maxEventsPerSpan: 128,
      ...partial,
    })

    it('always emits service.name', () => {
      // The server reads service_name only from this attribute and stores an
      // empty string when it's missing, leaving spans unattributable.
      expect(buildTracesResourceAttributes(config(), 'posthog-node', '1.0.0')['service.name']).toBe('unknown_service')
    })

    it('uses the configured service name', () => {
      expect(buildTracesResourceAttributes(config({ serviceName: 'checkout' }), 'posthog-node', '1.0.0')).toMatchObject(
        {
          'service.name': 'checkout',
        }
      )
    })

    it('includes environment and version only when set', () => {
      const attributes = buildTracesResourceAttributes(
        config({ environment: 'production', serviceVersion: '2.1.0' }),
        'posthog-node',
        '1.0.0'
      )
      expect(attributes['deployment.environment']).toBe('production')
      expect(attributes['service.version']).toBe('2.1.0')
      expect(buildTracesResourceAttributes(config(), 'posthog-node', '1.0.0')).not.toHaveProperty(
        'deployment.environment'
      )
    })

    it('protects SDK identity keys from user resource attributes', () => {
      const attributes = buildTracesResourceAttributes(
        config({ resourceAttributes: { 'telemetry.sdk.name': 'custom', 'host.name': 'web-01' } }),
        'posthog-node',
        '1.0.0'
      )
      expect(attributes['telemetry.sdk.name']).toBe('posthog-node')
      expect(attributes['host.name']).toBe('web-01')
    })
  })

  describe('buildOtlpTracesPayload', () => {
    it('produces one resource, one scope, N spans', () => {
      const spans = [buildOtlpSpan(record()), buildOtlpSpan(record({ name: 'other' }))]
      const payload = buildOtlpTracesPayload(spans, { 'service.name': 'checkout' }, 'posthog-node', '1.0.0')

      expect(payload.resourceSpans).toHaveLength(1)
      expect(payload.resourceSpans[0].scopeSpans).toHaveLength(1)
      expect(payload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2)
      expect(payload.resourceSpans[0].scopeSpans[0].scope).toEqual({ name: 'posthog-node', version: '1.0.0' })
      expect(payload.resourceSpans[0].resource.attributes).toEqual([
        { key: 'service.name', value: { stringValue: 'checkout' } },
      ])
    })
  })

  describe('golden wire fixture', () => {
    it('matches the shape the ingestion service accepts', () => {
      // Pinned against the OTLP/JSON encoding the capture-logs service's own
      // trace fixtures use: hex ids, string nanosecond timestamps, integer kind
      // and status enums, and stringified int64 attribute values.
      const payload = buildOtlpTracesPayload(
        [
          buildOtlpSpan(
            record({
              parentSpanId: 'b7ad6b7169203331',
              name: 'GET /users/:id',
              kind: 'server',
              status: { code: 'error', message: 'boom' },
              attributes: {
                posthogDistinctId: 'user-123',
                sessionId: 'session-123',
                'http.status_code': 500,
                'http.duration_ratio': 0.25,
                cached: false,
              },
              events: [
                {
                  name: 'exception',
                  timestamp: 1_700_000_000_040,
                  attributes: { 'exception.type': 'TypeError', 'exception.message': 'boom' },
                },
              ],
            })
          ),
        ],
        { 'service.name': 'checkout-api', 'telemetry.sdk.name': 'posthog-node' },
        'posthog-node',
        '1.0.0'
      )

      expect(payload).toEqual({
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'checkout-api' } },
                { key: 'telemetry.sdk.name', value: { stringValue: 'posthog-node' } },
              ],
            },
            scopeSpans: [
              {
                scope: { name: 'posthog-node', version: '1.0.0' },
                spans: [
                  {
                    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
                    spanId: '00f067aa0ba902b7',
                    parentSpanId: 'b7ad6b7169203331',
                    name: 'GET /users/:id',
                    kind: 2,
                    startTimeUnixNano: '1700000000000000000',
                    endTimeUnixNano: '1700000000080000000',
                    flags: 1,
                    attributes: [
                      { key: 'posthogDistinctId', value: { stringValue: 'user-123' } },
                      { key: 'sessionId', value: { stringValue: 'session-123' } },
                      { key: 'http.status_code', value: { intValue: '500' } },
                      { key: 'http.duration_ratio', value: { doubleValue: 0.25 } },
                      { key: 'cached', value: { boolValue: false } },
                    ],
                    events: [
                      {
                        name: 'exception',
                        timeUnixNano: '1700000000040000000',
                        attributes: [
                          { key: 'exception.type', value: { stringValue: 'TypeError' } },
                          { key: 'exception.message', value: { stringValue: 'boom' } },
                        ],
                      },
                    ],
                    status: { code: 2, message: 'boom' },
                  },
                ],
              },
            ],
          },
        ],
      })
    })
  })
})
