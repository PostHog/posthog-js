import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

// The header has to survive the whole path: response → PostHogFetchHttpError →
// the retry-later outcome each queue reads. A unit test of the parser alone
// would still pass if the plumbing were missing.
describe('OTLP Retry-After', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  const respondWith = (status: number, retryAfter?: string): void => {
    mocks.fetch.mockResolvedValue({
      status,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
      headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' && retryAfter ? retryAfter : null) },
    })
  }

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
      host: 'http://example.com',
      preloadFeatureFlags: false,
      disableCompression: true,
      fetchRetryCount: 0,
    })
  })

  it.each([
    ['logs', () => posthog._sendLogsBatch({ resourceLogs: [] } as any)],
    ['metrics', () => posthog._sendMetricsBatch({ resourceMetrics: [] } as any)],
    ['traces', () => posthog._sendTracesBatch({ resourceSpans: [] } as any)],
  ])("surfaces the endpoint's Retry-After to the %s queue", async (_signal, send) => {
    respondWith(429, '120')

    const outcome = await send()

    expect(outcome).toMatchObject({ kind: 'retry-later', retryAfterMs: 120_000 })
  })

  it('sends once, not once per inner retry, when the endpoint names a wait', async () => {
    // The inner retriable loop retries on a short fixed delay. Spending its
    // attempts here would put three extra requests inside the very window the
    // queue is about to back off for.
    const [client, clientMocks] = createTestClient('TEST_API_KEY', {
      host: 'http://example.com',
      preloadFeatureFlags: false,
      disableCompression: true,
    })
    clientMocks.fetch.mockResolvedValue({
      status: 429,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
      headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '120' : null) },
    })

    const pending = client._sendTracesBatch({ resourceSpans: [] } as any)
    await jest.advanceTimersByTimeAsync(60_000)

    expect(await pending).toMatchObject({ kind: 'retry-later', retryAfterMs: 120_000 })
    expect(clientMocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('still retries internally when the response names no wait', async () => {
    const [client, clientMocks] = createTestClient('TEST_API_KEY', {
      host: 'http://example.com',
      preloadFeatureFlags: false,
      disableCompression: true,
    })
    clientMocks.fetch.mockResolvedValue({
      status: 503,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
      headers: { get: () => null },
    })

    const pending = client._sendTracesBatch({ resourceSpans: [] } as any)
    await jest.advanceTimersByTimeAsync(60_000)

    expect((await pending).kind).toBe('retry-later')
    expect(clientMocks.fetch.mock.calls.length).toBeGreaterThan(1)
  })

  it('leaves retryAfterMs unset when the response sends no header', async () => {
    respondWith(503)

    const outcome = await posthog._sendTracesBatch({ resourceSpans: [] } as any)

    expect(outcome.kind).toBe('retry-later')
    expect((outcome as { retryAfterMs?: number }).retryAfterMs).toBeUndefined()
  })

  it('survives a transport whose headers accessor throws', async () => {
    mocks.fetch.mockResolvedValue({
      status: 503,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
      headers: {
        get: () => {
          throw new Error('hostile transport')
        },
      },
    })

    const outcome = await posthog._sendTracesBatch({ resourceSpans: [] } as any)

    expect(outcome.kind).toBe('retry-later')
  })
})
