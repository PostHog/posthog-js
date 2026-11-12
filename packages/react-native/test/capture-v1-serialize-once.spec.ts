import { serializeV1Event } from '@posthog/core/capture-v1'
import { PostHog } from '../src'

vi.mock('@posthog/core/capture-v1', async (importOriginal) => {
  const original = await importOriginal<typeof import('@posthog/core/capture-v1')>()
  return { ...original, serializeV1Event: vi.fn(original.serializeV1Event) }
})

describe('React Native capture v1 serialization', () => {
  const originalFetch = (globalThis as any).window.fetch

  beforeAll(() => {
    vi.useRealTimers()
  })

  afterAll(() => {
    ;(globalThis as any).window.fetch = originalFetch
    vi.useFakeTimers()
  })

  it('serializes each event once per flush, for sizing and sending', async () => {
    ;(globalThis as any).window.fetch = vi.fn(async () => ({
      status: 200,
      headers: { get: () => null },
      json: async () => ({ results: {} }),
      text: async () => '{"results":{}}',
    }))
    const posthog = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      preloadFeatureFlags: false,
      disableCompression: true,
      captureAppLifecycleEvents: false,
    })
    await posthog.ready()
    posthog.capture('a')
    posthog.capture('b')
    posthog.capture('c')
    vi.mocked(serializeV1Event).mockClear()

    await posthog.flush()

    expect(serializeV1Event).toHaveBeenCalledTimes(3)
    await posthog.shutdown()
  })
})
