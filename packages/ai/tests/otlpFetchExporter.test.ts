import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { TraceFlags } from '@opentelemetry/api'

import { OtlpFetchTraceExporter } from '../src/otel/otlpFetchExporter'

const URL_UNDER_TEST = 'https://us.i.posthog.com/i/v0/ai/otel'

function makeSpan(): ReadableSpan {
  return {
    name: 'gen_ai.chat',
    attributes: {},
    events: [],
    links: [],
    spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: TraceFlags.SAMPLED }),
  } as unknown as ReadableSpan
}

function exportOnce(exporter: OtlpFetchTraceExporter): Promise<{ code: number; error?: Error }> {
  return new Promise((resolve) => exporter.export([makeSpan()], resolve))
}

describe('OtlpFetchTraceExporter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reports success without a request when there is nothing to export', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const exporter = new OtlpFetchTraceExporter({ url: URL_UNDER_TEST, headers: {} })

    const result = await new Promise<{ code: number }>((resolve) => exporter.export([], resolve))

    expect(result.code).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries a retryable status and succeeds on the next attempt', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const exporter = new OtlpFetchTraceExporter({ url: URL_UNDER_TEST, headers: {} })

    const result = exportOnce(exporter)
    await vi.advanceTimersByTimeAsync(2000)

    expect((await result).code).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('waits for the Retry-After delay the endpoint asks for', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '30' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const exporter = new OtlpFetchTraceExporter({ url: URL_UNDER_TEST, headers: {} })

    const result = exportOnce(exporter)
    await vi.advanceTimersByTimeAsync(29_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect((await result).code).toBe(0)
  })

  it('gives up after a network failure on every attempt', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)
    const exporter = new OtlpFetchTraceExporter({ url: URL_UNDER_TEST, headers: {} })

    const result = exportOnce(exporter)
    await vi.advanceTimersByTimeAsync(60_000)

    expect((await result).code).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('does not retry a non-retryable status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    const exporter = new OtlpFetchTraceExporter({ url: URL_UNDER_TEST, headers: {} })

    expect((await exportOnce(exporter)).code).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('forceFlush waits for in-flight requests', async () => {
    let settle = (_response: Response) => {}
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => (settle = resolve)))
    vi.stubGlobal('fetch', fetchMock)
    const exporter = new OtlpFetchTraceExporter({ url: URL_UNDER_TEST, headers: {} })

    const callback = vi.fn()
    exporter.export([makeSpan()], callback)
    const flushed = exporter.forceFlush()
    expect(callback).not.toHaveBeenCalled()

    settle(new Response('{}', { status: 200 }))
    await flushed
    expect(callback).toHaveBeenCalledWith({ code: 0 })
  })

  it('refuses to export after shutdown', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const exporter = new OtlpFetchTraceExporter({ url: URL_UNDER_TEST, headers: {} })
    await exporter.shutdown()

    expect((await exportOnce(exporter)).code).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
