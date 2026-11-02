import { performance } from 'node:perf_hooks'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { PostHog } from 'posthog-node'
import { PostHogGenkitSpanProcessor, type PostHogGenkitSpanProcessorOptions } from '../src/genkit'

const spanKinds = [
  { name: 'flow', attributes: { 'genkit:isRoot': true }, event: '$ai_trace' },
  { name: 'tool', attributes: { 'genkit:metadata:subtype': 'tool' }, event: '$ai_span' },
  { name: 'fake/model', attributes: { 'genkit:metadata:subtype': 'model' }, event: '$ai_generation' },
  { name: 'fake/embedder', attributes: { 'genkit:metadata:subtype': 'embedder' }, event: '$ai_embedding' },
]

describe('PostHogGenkitSpanProcessor with a custom OpenTelemetry provider', () => {
  let client: PostHog
  let capture: ReturnType<typeof vi.spyOn<PostHog, 'capture'>>
  let providers: BasicTracerProvider[]

  function tracer(options: Omit<PostHogGenkitSpanProcessorOptions, 'client'> = {}) {
    const provider = new BasicTracerProvider({
      spanProcessors: [new PostHogGenkitSpanProcessor({ client, ...options })],
    })
    providers.push(provider)
    return provider.getTracer('genkit-test')
  }

  beforeEach(() => {
    client = new PostHog('phc_test', { host: 'http://127.0.0.1:9', flushAt: 1000, flushInterval: 0 })
    capture = vi.spyOn(client, 'capture').mockImplementation(() => {})
    providers = []
  })

  afterEach(async () => {
    await Promise.all(providers.map((provider) => provider.shutdown()))
    await client.shutdown()
  })

  it.each(spanKinds)(
    'keeps the starting identity after its context exits for $event',
    ({ name, attributes, event }) => {
      const otel = tracer()
      const span = client.withContext({ distinctId: 'starting-user' }, () =>
        otel.startSpan(name, { attributes: { 'genkit:type': 'action', ...attributes } })
      )

      span.end()

      expect(capture).toHaveBeenCalledWith(expect.objectContaining({ event, distinctId: 'starting-user' }))
    }
  )

  it.each(spanKinds)('ignores another request context at span end for $event', ({ name, attributes, event }) => {
    const otel = tracer()
    const span = client.withContext({ distinctId: 'starting-user' }, () =>
      otel.startSpan(name, { attributes: { 'genkit:type': 'action', ...attributes } })
    )

    client.withContext({ distinctId: 'ending-user' }, () => span.end())

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ event, distinctId: 'starting-user' }))
  })

  it('does not attribute a span started without a context to the ending request', () => {
    const span = tracer().startSpan('flow', { attributes: { 'genkit:type': 'flow', 'genkit:isRoot': true } })

    client.withContext({ distinctId: 'ending-user' }, () => span.end())

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: span.spanContext().traceId,
        properties: expect.objectContaining({ $process_person_profile: false }),
      })
    )
  })

  it('prefers an explicit distinct ID over the starting context', () => {
    const otel = tracer({ distinctId: 'explicit-user' })
    const span = client.withContext({ distinctId: 'starting-user' }, () =>
      otel.startSpan('flow', { attributes: { 'genkit:type': 'flow' } })
    )

    span.end()

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ distinctId: 'explicit-user' }))
  })

  it('still captures the event if reading the starting context fails', () => {
    const failure = new Error('context unavailable')
    const onError = vi.fn()
    const otel = tracer({ onError })
    vi.spyOn(client, 'getContext').mockImplementation(() => {
      throw failure
    })

    const span = otel.startSpan('flow', { attributes: { 'genkit:type': 'flow' } })
    expect(() => span.end()).not.toThrow()

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ distinctId: span.spanContext().traceId }))
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('preserves media parameters, MIME overrides and payload commas when parsing data URLs', () => {
    tracer()
      .startSpan('fake/model', {
        attributes: {
          'genkit:type': 'action',
          'genkit:metadata:subtype': 'model',
          'genkit:input': JSON.stringify({
            messages: [
              {
                role: 'user',
                content: [
                  { media: { url: 'data:image/png;charset=utf-8;base64,aGVsbG8=' } },
                  { media: { url: 'data:;base64,aGVsbG8=', contentType: 'application/pdf' } },
                  { media: { url: 'data:image/png,not-base64,payload' } },
                ],
              },
            ],
          }),
        },
      })
      .end()

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          $ai_input: [
            {
              role: 'user',
              content: [
                { type: 'image', inline_data: { mime_type: 'image/png', data: '[base64 image/png redacted]' } },
                {
                  type: 'document',
                  inline_data: { mime_type: 'application/pdf', data: '[base64 application/pdf redacted]' },
                },
                { type: 'image', image: 'data:image/png,not-base64,payload' },
              ],
            },
          ],
        }),
      })
    )
  })

  it('processes long data URLs without a base64 marker without blocking the event loop', () => {
    const span = tracer().startSpan('fake/model', {
      attributes: {
        'genkit:type': 'action',
        'genkit:metadata:subtype': 'model',
        'genkit:input': JSON.stringify({
          messages: [{ role: 'user', content: [{ media: { url: `data:${'+'.repeat(40_000)}` } }] }],
        }),
      },
    })

    const start = performance.now()
    span.end()
    const elapsed = performance.now() - start

    expect(capture).toHaveBeenCalledTimes(1)
    expect(elapsed).toBeLessThan(250)
  })
})
