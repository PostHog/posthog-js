import { PostHogTraceExporter } from '../src/otel'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

jest.mock('@opentelemetry/exporter-trace-otlp-http', () => {
  const MockExporter = jest.fn()
  MockExporter.prototype.export = jest.fn()
  MockExporter.prototype.shutdown = jest.fn().mockResolvedValue(undefined)
  MockExporter.prototype.forceFlush = jest.fn().mockResolvedValue(undefined)
  return { OTLPTraceExporter: MockExporter }
})

const DEFAULT_TOKEN = 'phc_test'

function makeSpan(name: string, attributes: Record<string, unknown> = {}): ReadableSpan {
  return { name, attributes } as unknown as ReadableSpan
}

function getSuperExport(): jest.Mock {
  return OTLPTraceExporter.prototype.export as jest.Mock
}

function getSuperShutdown(): jest.Mock {
  return OTLPTraceExporter.prototype.shutdown as jest.Mock
}

function getSuperForceFlush(): jest.Mock {
  return OTLPTraceExporter.prototype.forceFlush as jest.Mock
}

describe('PostHogTraceExporter', () => {
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
      name: 'multiple trailing slashes',
      projectToken: 'phc_test000',
      host: 'https://custom.posthog.com///',
      expectedUrl: 'https://custom.posthog.com/i/v0/ai/otel',
      expectedToken: 'phc_test000',
    },
    {
      name: 'trimmed whitespace-sensitive values',
      projectToken: '  phc_test999\t ',
      host: '  https://custom.posthog.com/\n',
      expectedUrl: 'https://custom.posthog.com/i/v0/ai/otel',
      expectedToken: 'phc_test999',
    },
  ])('configures the OTLP exporter correctly with $name', ({ projectToken, host, expectedUrl, expectedToken }) => {
    new PostHogTraceExporter({ projectToken, host })

    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: expectedUrl,
      headers: {
        Authorization: `Bearer ${expectedToken}`,
      },
    })
  })

  it('accepts deprecated apiKey', () => {
    new PostHogTraceExporter({ apiKey: DEFAULT_TOKEN })
    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: 'https://us.i.posthog.com/i/v0/ai/otel',
      headers: { Authorization: `Bearer ${DEFAULT_TOKEN}` },
    })
  })

  it('throws when projectToken is missing', () => {
    expect(() => new PostHogTraceExporter({ projectToken: '' })).toThrow('PostHogTraceExporter requires a projectToken')
    expect(() => new PostHogTraceExporter({ projectToken: '  \n\t ' })).toThrow(
      'PostHogTraceExporter requires a projectToken'
    )
  })

  it('inherits shutdown from OTLPTraceExporter', async () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    await exporter.shutdown()
    expect(getSuperShutdown()).toHaveBeenCalled()
  })

  it('inherits forceFlush from OTLPTraceExporter', async () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    await exporter.forceFlush()
    expect(getSuperForceFlush()).toHaveBeenCalled()
  })
})

describe('PostHogTraceExporter AI span filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('exports only AI spans', () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    const callback = jest.fn()

    exporter.export([makeSpan('gen_ai.chat'), makeSpan('http.request'), makeSpan('llm.completion')], callback)

    expect(getSuperExport()).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'gen_ai.chat' }), expect.objectContaining({ name: 'llm.completion' })],
      callback
    )
  })

  it('calls back with success immediately when no AI spans are present', () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    const callback = jest.fn()

    exporter.export([makeSpan('http.request'), makeSpan('db.query')], callback)

    expect(getSuperExport()).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith({ code: 0 })
  })

  it('detects AI spans by attribute keys', () => {
    const exporter = new PostHogTraceExporter({ projectToken: DEFAULT_TOKEN })
    const callback = jest.fn()

    exporter.export([makeSpan('some.operation', { 'gen_ai.model': 'gpt-4' }), makeSpan('other.operation')], callback)

    expect(getSuperExport()).toHaveBeenCalledWith([expect.objectContaining({ name: 'some.operation' })], callback)
  })
})
