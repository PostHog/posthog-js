import { PostHogTraceExporter } from '../src/otel'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

jest.mock('@opentelemetry/exporter-trace-otlp-http', () => {
  return {
    OTLPTraceExporter: jest.fn(),
  }
})

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
})
