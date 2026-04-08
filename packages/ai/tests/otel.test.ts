import { PostHogTraceExporter } from '../src/otel'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

const mockExport = jest.fn()
const mockShutdown = jest.fn().mockResolvedValue(undefined)
const mockForceFlush = jest.fn().mockResolvedValue(undefined)

jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: jest.fn().mockImplementation(() => ({
    export: mockExport,
    shutdown: mockShutdown,
    forceFlush: mockForceFlush,
  })),
}))

function makeSpan(name: string, attributes: Record<string, unknown> = {}): ReadableSpan {
  return { name, attributes } as unknown as ReadableSpan
}

describe('PostHogTraceExporter', () => {
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
    {
      name: 'multiple trailing slashes',
      apiKey: 'phc_test000',
      host: 'https://custom.posthog.com///',
      expectedUrl: 'https://custom.posthog.com/i/v0/ai/otel',
    },
  ])('configures the OTLP exporter correctly with $name', ({ apiKey, host, expectedUrl }) => {
    new PostHogTraceExporter({ apiKey, host })

    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: expectedUrl,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
  })

  it('throws when apiKey is missing', () => {
    expect(() => new PostHogTraceExporter({ apiKey: '' })).toThrow('PostHogTraceExporter requires an apiKey')
  })

  it('delegates shutdown', async () => {
    const exporter = new PostHogTraceExporter({ apiKey: 'phc_test' })
    await exporter.shutdown()
    expect(mockShutdown).toHaveBeenCalled()
  })

  it('delegates forceFlush', async () => {
    const exporter = new PostHogTraceExporter({ apiKey: 'phc_test' })
    await exporter.forceFlush()
    expect(mockForceFlush).toHaveBeenCalled()
  })
})

describe('PostHogTraceExporter AI span filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('exports only AI spans', () => {
    const exporter = new PostHogTraceExporter({ apiKey: 'phc_test' })
    const callback = jest.fn()

    exporter.export([makeSpan('gen_ai.chat'), makeSpan('http.request'), makeSpan('llm.completion')], callback)

    expect(mockExport).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'gen_ai.chat' }), expect.objectContaining({ name: 'llm.completion' })],
      callback
    )
  })

  it('calls back with success immediately when no AI spans are present', () => {
    const exporter = new PostHogTraceExporter({ apiKey: 'phc_test' })
    const callback = jest.fn()

    exporter.export([makeSpan('http.request'), makeSpan('db.query')], callback)

    expect(mockExport).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith({ code: 0 })
  })

  it('detects AI spans by attribute keys', () => {
    const exporter = new PostHogTraceExporter({ apiKey: 'phc_test' })
    const callback = jest.fn()

    exporter.export([makeSpan('some.operation', { 'gen_ai.model': 'gpt-4' }), makeSpan('other.operation')], callback)

    expect(mockExport).toHaveBeenCalledWith([expect.objectContaining({ name: 'some.operation' })], callback)
  })
})
