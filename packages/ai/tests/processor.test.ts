import type { SpanProcessor, ReadableSpan, Span } from '@opentelemetry/sdk-trace-base'
import type { Context } from '@opentelemetry/api'
import { PostHogSpanProcessor } from '../src/otel'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: vi.fn(),
}))

vi.mock('@opentelemetry/sdk-trace-base', () => {
  throw new Error('@opentelemetry/sdk-trace-base must not be imported at runtime')
})

type ExportCallback = (result: { code: number; error?: Error }) => void

function mockExporter(code = 0): { export: vi.Mock; shutdown: vi.Mock } {
  const exporter = {
    export: vi.fn((_spans: ReadableSpan[], callback: ExportCallback) => callback({ code })),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }
  vi.mocked(OTLPTraceExporter).mockImplementation(function () {
    return exporter
  } as any)
  return exporter
}

function mockProcessor(): SpanProcessor & { onStart: vi.Mock; onEnd: vi.Mock } {
  return {
    onStart: vi.fn(),
    onEnd: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    forceFlush: vi.fn().mockResolvedValue(undefined),
  }
}

function makeSpan(name: string, attributes: Record<string, unknown> = {}): ReadableSpan {
  return { name, attributes } as unknown as ReadableSpan
}

describe('PostHogSpanProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    {
      name: 'default host',
      projectToken: 'phc_test123',
      host: undefined,
      expectedUrl: 'https://us.i.posthog.com/i/v0/ai/otel',
      expectedToken: 'phc_test123',
    },
    {
      name: 'custom host',
      projectToken: 'phc_test456',
      host: 'https://eu.i.posthog.com',
      expectedUrl: 'https://eu.i.posthog.com/i/v0/ai/otel',
      expectedToken: 'phc_test456',
    },
    {
      name: 'trailing slash',
      projectToken: 'phc_test789',
      host: 'https://custom.posthog.com/',
      expectedUrl: 'https://custom.posthog.com/i/v0/ai/otel',
      expectedToken: 'phc_test789',
    },
    {
      name: 'trimmed whitespace-sensitive values',
      projectToken: '  phc_test999\t ',
      host: '  https://custom.posthog.com/\n',
      expectedUrl: 'https://custom.posthog.com/i/v0/ai/otel',
      expectedToken: 'phc_test999',
    },
  ])('configures the OTLP exporter correctly with $name', ({ projectToken, host, expectedUrl, expectedToken }) => {
    new PostHogSpanProcessor({ projectToken, host })

    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: expectedUrl,
      headers: { Authorization: `Bearer ${expectedToken}` },
    })
  })

  it.each([
    ['missing', {}],
    ['empty', { projectToken: '' }],
    ['blank', { projectToken: '  \n\t ' }],
  ])('disables and no-ops when projectToken is %s', async (_case, options) => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const processor = new PostHogSpanProcessor(options as any)

    processor.onStart({} as Span, {} as Context)
    processor.onEnd(makeSpan('gen_ai.chat'))
    await expect(processor.shutdown()).resolves.toBeUndefined()
    await expect(processor.forceFlush()).resolves.toBeUndefined()

    expect(OTLPTraceExporter).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      '[PostHogSpanProcessor] projectToken is missing or blank; the processor will be disabled.'
    )
    warnSpy.mockRestore()
  })

  it('delegates onStart to the inner processor', () => {
    const inner = mockProcessor()
    const processor = new PostHogSpanProcessor({ projectToken: 'phc_test', _spanProcessor: inner })

    const span = {} as Span
    const ctx = {} as Context
    processor.onStart(span, ctx)

    expect(inner.onStart).toHaveBeenCalledWith(span, ctx)
  })

  it('delegates shutdown', async () => {
    const inner = mockProcessor()
    const processor = new PostHogSpanProcessor({ projectToken: 'phc_test', _spanProcessor: inner })

    await processor.shutdown()
    expect(inner.shutdown).toHaveBeenCalled()
  })

  it('delegates forceFlush', async () => {
    const inner = mockProcessor()
    const processor = new PostHogSpanProcessor({ projectToken: 'phc_test', _spanProcessor: inner })

    await processor.forceFlush()
    expect(inner.forceFlush).toHaveBeenCalled()
  })
})

describe('PostHogSpanProcessor batching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exports queued AI spans in one batch on forceFlush', async () => {
    const exporter = mockExporter()
    const processor = new PostHogSpanProcessor({ projectToken: 'phc_test' })

    processor.onEnd(makeSpan('gen_ai.chat'))
    processor.onEnd(makeSpan('http.request'))
    processor.onEnd(makeSpan('gen_ai.embeddings'))
    expect(exporter.export).not.toHaveBeenCalled()

    await processor.forceFlush()

    expect(exporter.export).toHaveBeenCalledTimes(1)
    expect(exporter.export.mock.calls[0][0].map((span: ReadableSpan) => span.name)).toEqual([
      'gen_ai.chat',
      'gen_ai.embeddings',
    ])
  })

  it('exports queued spans after the scheduled delay', async () => {
    vi.useFakeTimers()
    const exporter = mockExporter()
    const processor = new PostHogSpanProcessor({ projectToken: 'phc_test' })

    processor.onEnd(makeSpan('gen_ai.chat'))
    await vi.advanceTimersByTimeAsync(4999)
    expect(exporter.export).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(exporter.export).toHaveBeenCalledTimes(1)
  })

  it('exports a full batch without waiting for the scheduled delay', () => {
    const exporter = mockExporter()
    const processor = new PostHogSpanProcessor({ projectToken: 'phc_test' })

    for (let i = 0; i < 512; i++) {
      processor.onEnd(makeSpan('gen_ai.chat'))
    }

    expect(exporter.export).toHaveBeenCalledTimes(1)
    expect(exporter.export.mock.calls[0][0]).toHaveLength(512)
  })

  it('rejects forceFlush when the export fails', async () => {
    mockExporter(1)
    const processor = new PostHogSpanProcessor({ projectToken: 'phc_test' })

    processor.onEnd(makeSpan('gen_ai.chat'))

    await expect(processor.forceFlush()).rejects.toThrow('span export failed')
  })

  it('flushes and shuts down the exporter once, then ignores new spans', async () => {
    const exporter = mockExporter()
    const processor = new PostHogSpanProcessor({ projectToken: 'phc_test' })

    processor.onEnd(makeSpan('gen_ai.chat'))
    await Promise.all([processor.shutdown(), processor.shutdown()])
    processor.onEnd(makeSpan('gen_ai.chat'))
    await processor.forceFlush()

    expect(exporter.export).toHaveBeenCalledTimes(1)
    expect(exporter.shutdown).toHaveBeenCalledTimes(1)
  })
})

describe('PostHogSpanProcessor AI span filtering', () => {
  it('forwards spans with AI name prefixes', () => {
    const inner = mockProcessor()
    const processor = new PostHogSpanProcessor({ projectToken: 'phc_test', _spanProcessor: inner })

    processor.onEnd(makeSpan('gen_ai.chat'))
    processor.onEnd(makeSpan('llm.completion'))
    processor.onEnd(makeSpan('ai.invoke'))
    processor.onEnd(makeSpan('traceloop.workflow'))

    expect(inner.onEnd).toHaveBeenCalledTimes(4)
  })

  it('drops non-AI spans', () => {
    const inner = mockProcessor()
    const processor = new PostHogSpanProcessor({ projectToken: 'phc_test', _spanProcessor: inner })

    processor.onEnd(makeSpan('http.request'))
    processor.onEnd(makeSpan('db.query'))
    processor.onEnd(makeSpan('custom.operation'))

    expect(inner.onEnd).not.toHaveBeenCalled()
  })

  it('detects AI spans by attribute keys', () => {
    const inner = mockProcessor()
    const processor = new PostHogSpanProcessor({ projectToken: 'phc_test', _spanProcessor: inner })

    processor.onEnd(makeSpan('some.operation', { 'gen_ai.model': 'gpt-4' }))
    processor.onEnd(makeSpan('other.operation', { 'http.method': 'GET' }))

    expect(inner.onEnd).toHaveBeenCalledTimes(1)
  })

  it('redacts multimodal content before forwarding', () => {
    const inner = mockProcessor()
    const processor = new PostHogSpanProcessor({ projectToken: 'phc_test', _spanProcessor: inner })

    processor.onEnd(makeSpan('gen_ai.chat', { 'gen_ai.prompt': 'data:image/png;base64,iVBORw0KGgo' }))

    const forwarded = inner.onEnd.mock.calls[0][0] as ReadableSpan
    expect(forwarded.attributes['gen_ai.prompt']).toBe('[base64 image/png redacted]')
  })
})
