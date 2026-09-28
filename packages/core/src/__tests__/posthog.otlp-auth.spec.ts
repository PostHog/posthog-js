import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

// One `_sendOtlpBatch` serves logs, metrics and traces, and the endpoint each one
// authenticates against is a single argument away from the wrong scheme. These pin
// all three so a flipped argument fails here rather than shipping the project key
// in a header the logs endpoint does not expect.
describe('OTLP batch auth', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
      host: 'http://example.com',
      preloadFeatureFlags: false,
      disableCompression: true,
    })
    mocks.fetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('ok'),
      json: () => Promise.resolve({ status: 'ok' }),
    })
  })

  const lastCall = (): [string, any] => mocks.fetch.mock.calls[mocks.fetch.mock.calls.length - 1] as [string, any]

  it('sends logs to the query-token endpoint with no Authorization header', async () => {
    await posthog._sendLogsBatch({ resourceLogs: [] } as any)

    const [url, options] = lastCall()
    expect(url).toBe('http://example.com/i/v1/logs?token=TEST_API_KEY')
    expect(options.headers).not.toHaveProperty('Authorization')
  })

  it('sends metrics to the query-token endpoint with no Authorization header', async () => {
    await posthog._sendMetricsBatch({ resourceMetrics: [] } as any)

    const [url, options] = lastCall()
    expect(url).toBe('http://example.com/i/v1/metrics?token=TEST_API_KEY')
    expect(options.headers).not.toHaveProperty('Authorization')
  })

  it('sends traces with bearer auth and no token in the query string', async () => {
    await posthog._sendTracesBatch({ resourceSpans: [] } as any)

    const [url, options] = lastCall()
    expect(url).toBe('http://example.com/i/v1/traces')
    expect(options.headers.Authorization).toBe('Bearer TEST_API_KEY')
  })
})
