import type { SpanProcessor, ReadableSpan, Span } from '@opentelemetry/sdk-trace-base'
import type { Context } from '@opentelemetry/api'
import { PostHogSpanProcessor } from '../src/otel'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'

jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: jest.fn(),
}))

jest.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: jest.fn().mockImplementation(() => ({
    onStart: jest.fn(),
    onEnd: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
    forceFlush: jest.fn().mockResolvedValue(undefined),
  })),
}))

function mockProcessor(): SpanProcessor & { onStart: jest.Mock; onEnd: jest.Mock } {
  return {
    onStart: jest.fn(),
    onEnd: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
    forceFlush: jest.fn().mockResolvedValue(undefined),
  }
}

function makeSpan(name: string, attributes: Record<string, unknown> = {}): ReadableSpan {
  return { name, attributes } as unknown as ReadableSpan
}

describe('PostHogSpanProcessor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
    expect(BatchSpanProcessor).toHaveBeenCalledWith(expect.any(Object))
  })

  it('routes project secrets through the AI gateway', () => {
    new PostHogSpanProcessor({ projectSecret: '  phs_test123  ' })

    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: 'https://ai-gateway.us.posthog.com/i/v0/ai/otel',
      headers: { Authorization: 'Bearer phs_test123' },
    })
    expect(BatchSpanProcessor).toHaveBeenCalledWith(expect.any(Object))
  })

  it.each([
    ['missing', {}],
    ['empty', { projectToken: '' }],
    ['blank', { projectToken: '  \n\t ' }],
  ])('disables and no-ops when projectToken is %s', async (_case, options) => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const processor = new PostHogSpanProcessor(options as any)

    processor.onStart({} as Span, {} as Context)
    processor.onEnd(makeSpan('gen_ai.chat'))
    await expect(processor.shutdown()).resolves.toBeUndefined()
    await expect(processor.forceFlush()).resolves.toBeUndefined()

    expect(OTLPTraceExporter).not.toHaveBeenCalled()
    expect(BatchSpanProcessor).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      '[PostHogSpanProcessor] projectToken or projectSecret is missing or blank; the processor will be disabled.'
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
