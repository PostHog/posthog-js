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
      apiKey: 'phc_test123',
      host: undefined,
      expectedUrl: 'https://us.i.posthog.com/i/v0/ai/otel',
    },
    {
      name: 'custom host',
      apiKey: 'phc_test456',
      host: 'https://eu.i.posthog.com',
      expectedUrl: 'https://eu.i.posthog.com/i/v0/ai/otel',
    },
    {
      name: 'trailing slash',
      apiKey: 'phc_test789',
      host: 'https://custom.posthog.com/',
      expectedUrl: 'https://custom.posthog.com/i/v0/ai/otel',
    },
  ])('configures the OTLP exporter correctly with $name', ({ apiKey, host, expectedUrl }) => {
    new PostHogSpanProcessor({ apiKey, host })

    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: expectedUrl,
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    expect(BatchSpanProcessor).toHaveBeenCalledWith(expect.any(Object))
  })

  it('throws when apiKey is missing', () => {
    expect(() => new PostHogSpanProcessor({ apiKey: '' })).toThrow('PostHogSpanProcessor requires an apiKey')
  })

  it('delegates onStart to the inner processor', () => {
    const inner = mockProcessor()
    const processor = new PostHogSpanProcessor({ apiKey: 'phc_test', _spanProcessor: inner })

    const span = {} as Span
    const ctx = {} as Context
    processor.onStart(span, ctx)

    expect(inner.onStart).toHaveBeenCalledWith(span, ctx)
  })

  it('delegates shutdown', async () => {
    const inner = mockProcessor()
    const processor = new PostHogSpanProcessor({ apiKey: 'phc_test', _spanProcessor: inner })

    await processor.shutdown()
    expect(inner.shutdown).toHaveBeenCalled()
  })

  it('delegates forceFlush', async () => {
    const inner = mockProcessor()
    const processor = new PostHogSpanProcessor({ apiKey: 'phc_test', _spanProcessor: inner })

    await processor.forceFlush()
    expect(inner.forceFlush).toHaveBeenCalled()
  })
})

describe('PostHogSpanProcessor AI span filtering', () => {
  it('forwards spans with AI name prefixes', () => {
    const inner = mockProcessor()
    const processor = new PostHogSpanProcessor({ apiKey: 'phc_test', _spanProcessor: inner })

    processor.onEnd(makeSpan('gen_ai.chat'))
    processor.onEnd(makeSpan('llm.completion'))
    processor.onEnd(makeSpan('ai.invoke'))
    processor.onEnd(makeSpan('traceloop.workflow'))

    expect(inner.onEnd).toHaveBeenCalledTimes(4)
  })

  it('drops non-AI spans', () => {
    const inner = mockProcessor()
    const processor = new PostHogSpanProcessor({ apiKey: 'phc_test', _spanProcessor: inner })

    processor.onEnd(makeSpan('http.request'))
    processor.onEnd(makeSpan('db.query'))
    processor.onEnd(makeSpan('custom.operation'))

    expect(inner.onEnd).not.toHaveBeenCalled()
  })

  it('detects AI spans by attribute keys', () => {
    const inner = mockProcessor()
    const processor = new PostHogSpanProcessor({ apiKey: 'phc_test', _spanProcessor: inner })

    processor.onEnd(makeSpan('some.operation', { 'gen_ai.model': 'gpt-4' }))
    processor.onEnd(makeSpan('other.operation', { 'http.method': 'GET' }))

    expect(inner.onEnd).toHaveBeenCalledTimes(1)
  })
})
