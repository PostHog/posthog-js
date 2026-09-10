import { JsonTraceSerializer } from '@opentelemetry/otlp-transformer'
import { SpanKind, SpanStatusCode, TraceFlags, createTraceState } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

import { serializeTraceRequest } from '../src/otel/otlpJson'

function makeSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
  const context = {
    traceId: 'd4cda95b652f4a1592b449d5929fda1b',
    spanId: '6e0c63257de34c92',
    traceFlags: TraceFlags.SAMPLED,
  }
  return {
    name: 'gen_ai.chat',
    kind: SpanKind.CLIENT,
    spanContext: () => context,
    parentSpanContext: undefined,
    startTime: [1735689600, 123456789],
    endTime: [1735689601, 987654321],
    status: { code: SpanStatusCode.OK },
    attributes: {},
    links: [],
    events: [],
    duration: [1, 864197532],
    ended: true,
    resource: { attributes: { 'service.name': 'test-service' } },
    instrumentationScope: { name: '@posthog/ai', version: '1.2.3' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ...overrides,
  } as unknown as ReadableSpan
}

function upstream(spans: ReadableSpan[]): unknown {
  return JSON.parse(new TextDecoder().decode(JsonTraceSerializer.serializeRequest(spans)))
}

// The OTLP/JSON body must stay byte-compatible with the OpenTelemetry
// serializer. If an upgrade of @opentelemetry/otlp-transformer adds a field,
// these tests fail and serializeTraceRequest needs the same field.
describe('serializeTraceRequest', () => {
  it.each([
    ['a minimal span', [makeSpan()]],
    [
      'every attribute value type',
      [
        makeSpan({
          attributes: {
            'gen_ai.system': 'openai',
            'gen_ai.usage.input_tokens': 42,
            'gen_ai.request.temperature': 0.7,
            'gen_ai.stream': false,
            'gen_ai.request.stop_sequences': ['stop', 'halt'],
          },
        }),
      ],
    ],
    [
      'events, links, a parent and a trace state',
      [
        makeSpan({
          parentSpanContext: {
            traceId: 'd4cda95b652f4a1592b449d5929fda1b',
            spanId: 'aa0c63257de34c92',
            traceFlags: TraceFlags.SAMPLED,
            isRemote: true,
          },
          events: [
            { name: 'gen_ai.content.prompt', time: [1735689600, 500000000], attributes: { role: 'user' } },
            { name: 'retry', time: [1735689601, 0] },
          ],
          links: [
            {
              context: {
                traceId: 'ffcda95b652f4a1592b449d5929fda1b',
                spanId: 'bb0c63257de34c92',
                traceFlags: TraceFlags.NONE,
                traceState: createTraceState('vendor=value'),
              },
              attributes: { reason: 'batch' },
            },
          ],
          status: { code: SpanStatusCode.ERROR, message: 'rate limited' },
          droppedAttributesCount: 1,
          droppedEventsCount: 2,
          droppedLinksCount: 3,
        }),
      ],
    ],
    ['binary attribute values', [makeSpan({ attributes: { 'gen_ai.blob': new Uint8Array([1, 2, 3, 250]) } as never })]],
    [
      'a scope that carries attributes',
      [
        makeSpan({
          instrumentationScope: {
            name: '@posthog/ai',
            version: '1.2.3',
            attributes: { 'scope.kind': 'ai' },
            droppedAttributesCount: 2,
          },
        } as never),
      ],
    ],
    [
      'spans from several resources and scopes',
      [
        makeSpan(),
        makeSpan({ instrumentationScope: { name: '@posthog/ai', version: '9.9.9' } }),
        makeSpan({ resource: { attributes: { 'service.name': 'other-service' } } as never }),
      ],
    ],
  ])('matches the OpenTelemetry serializer for %s', (_case, spans) => {
    expect(JSON.parse(serializeTraceRequest(spans as ReadableSpan[]))).toEqual(upstream(spans as ReadableSpan[]))
  })

  it('tolerates spans that carry no resource, scope, events or links', () => {
    const bare = {
      name: 'gen_ai.chat',
      spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: TraceFlags.SAMPLED }),
    } as unknown as ReadableSpan

    const [span] = JSON.parse(serializeTraceRequest([bare])).resourceSpans[0].scopeSpans[0].spans
    expect(span).toMatchObject({ name: 'gen_ai.chat', attributes: [], events: [], links: [] })
  })
})
