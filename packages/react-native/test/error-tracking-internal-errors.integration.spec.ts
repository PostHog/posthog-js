import { PostHog } from '../src'

// An offline flush is expected, not an application error: it must neither reject nor lose the event.
describe('offline capture flush', () => {
  const originalFetch = (globalThis as any).window.fetch

  beforeAll(() => {
    // The SDK flush/shutdown lifecycle is timer-driven; the suite's global fake timers
    // would deadlock awaited async operations, so use real timers here.
    vi.useRealTimers()
  })

  afterAll(() => {
    ;(globalThis as any).window.fetch = originalFetch
    vi.useFakeTimers()
  })

  it('resolves flush() and shutdown() while offline and sends the event once back online', async () => {
    ;(globalThis as any).window.fetch = vi.fn(() => {
      throw new Error('offline')
    })

    const posthog = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      preloadFeatureFlags: false,
      disableCompression: true,
      captureAppLifecycleEvents: false,
    })
    await posthog.ready()
    posthog.capture('offline event')

    await expect(posthog.flush()).resolves.toBeUndefined()

    const onlineFetch = vi.fn(async () => ({
      status: 200,
      text: async () => '{"results":{}}',
      json: async () => ({ results: {} }),
    }))
    ;(globalThis as any).window.fetch = onlineFetch
    await expect(posthog.shutdown()).resolves.toBeUndefined()

    const captureCalls = onlineFetch.mock.calls.filter(([url]) => String(url).includes('/i/v1/analytics/events'))
    expect(captureCalls).toHaveLength(1)
    const body = JSON.parse((captureCalls[0] as any)[1].body)
    expect(body.batch.map((event: { event: string }) => event.event)).toEqual(['offline event'])
  }, 15000)
})
