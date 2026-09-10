/**
 * End-to-end wiring on a Cloudflare Workers-shaped runtime: no XMLHttpRequest,
 * no navigator.sendBeacon, only fetch. See OtlpFetchTraceExporter for why that
 * used to drop every AI trace.
 *
 * Simulated inside Node rather than booting workerd. The regression guard for
 * the dependency that caused the bug lives in tests/otel-module-load.cjs; for a
 * real Workers environment, consider @cloudflare/vitest-pool-workers.
 */

import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'

import { PostHogSpanProcessor, PostHogTraceExporter } from '../src/otel'

const INGEST_URL = 'https://us.i.posthog.com/i/v0/ai/otel'

function stubFetch(response = new Response('{}', { status: 200 })): vi.Mock {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestBody(fetchMock: vi.Mock): any {
  return JSON.parse(fetchMock.mock.calls[0][1].body)
}

describe('OTLP export on a Cloudflare Workers-shaped runtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a generation from PostHogSpanProcessor to the ingest endpoint', async () => {
    const fetchMock = stubFetch()
    const provider = new BasicTracerProvider({
      spanProcessors: [new PostHogSpanProcessor({ projectToken: 'phc_workers' })],
    })

    const span = provider.getTracer('workers-test').startSpan('gen_ai.chat')
    span.setAttribute('gen_ai.system', 'openai')
    span.setAttribute('gen_ai.request.model', 'gpt-4o-mini')
    span.end()
    await provider.forceFlush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(INGEST_URL)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer phc_workers',
      'Content-Type': 'application/json',
    })

    const attributes = requestBody(fetchMock).resourceSpans[0].scopeSpans[0].spans[0].attributes
    expect(attributes).toEqual(
      expect.arrayContaining([
        { key: 'gen_ai.system', value: { stringValue: 'openai' } },
        { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o-mini' } },
      ])
    )
  })

  it('sends a generation from PostHogTraceExporter to the ingest endpoint', async () => {
    const fetchMock = stubFetch()
    const exporter = new PostHogTraceExporter({ projectToken: 'phc_workers', host: 'https://eu.i.posthog.com' })
    const provider = new BasicTracerProvider()

    const span = provider.getTracer('workers-test').startSpan('gen_ai.chat')
    span.end()
    const result = await new Promise<{ code: number }>((resolve) => exporter.export([span as any], resolve))

    expect(result.code).toBe(0)
    expect(fetchMock.mock.calls[0][0]).toBe('https://eu.i.posthog.com/i/v0/ai/otel')
  })
})
