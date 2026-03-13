import { PostHogTraceExporter } from '../src/otel'

jest.mock('@opentelemetry/exporter-trace-otlp-http', () => {
  return {
    OTLPTraceExporter: jest.fn().mockImplementation(function (this: any, config: any) {
      this._config = config
    }),
  }
})

describe('PostHogTraceExporter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('configures the OTLP exporter with the PostHog endpoint and auth header', () => {
    const exporter = new PostHogTraceExporter({ apiKey: 'phc_test123' })

    expect((exporter as any)._config).toEqual({
      url: 'https://us.i.posthog.com/i/v0/ai/otel',
      headers: {
        Authorization: 'Bearer phc_test123',
      },
    })
  })

  it('uses a custom host when provided', () => {
    const exporter = new PostHogTraceExporter({
      apiKey: 'phc_test456',
      host: 'https://eu.i.posthog.com',
    })

    expect((exporter as any)._config).toEqual({
      url: 'https://eu.i.posthog.com/i/v0/ai/otel',
      headers: {
        Authorization: 'Bearer phc_test456',
      },
    })
  })

  it('strips trailing slashes from the host', () => {
    const exporter = new PostHogTraceExporter({
      apiKey: 'phc_test789',
      host: 'https://custom.posthog.com/',
    })

    expect((exporter as any)._config).toEqual({
      url: 'https://custom.posthog.com/i/v0/ai/otel',
      headers: {
        Authorization: 'Bearer phc_test789',
      },
    })
  })

  it('strips multiple trailing slashes from the host', () => {
    const exporter = new PostHogTraceExporter({
      apiKey: 'phc_test000',
      host: 'https://custom.posthog.com///',
    })

    expect((exporter as any)._config).toEqual({
      url: 'https://custom.posthog.com/i/v0/ai/otel',
      headers: {
        Authorization: 'Bearer phc_test000',
      },
    })
  })
})
