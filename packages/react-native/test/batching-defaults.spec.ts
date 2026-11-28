import { PostHog } from '../src/posthog-rn'

describe('batching defaults', () => {
  let posthog: PostHog

  afterEach(async () => {
    await posthog.shutdown()
  })

  it('flushes every 30 seconds in batches of up to 50 events, like posthog-ios and posthog-android', async () => {
    posthog = new PostHog('token', { persistence: 'memory', preloadFeatureFlags: false })
    await posthog.ready()

    expect((posthog as any).flushInterval).toBe(30000)
    expect((posthog as any).maxBatchSize).toBe(50)
  })

  it('keeps the flushInterval and maxBatchSize you pass', async () => {
    posthog = new PostHog('token', {
      persistence: 'memory',
      preloadFeatureFlags: false,
      flushInterval: 10000,
      maxBatchSize: 100,
    })
    await posthog.ready()

    expect((posthog as any).flushInterval).toBe(10000)
    expect((posthog as any).maxBatchSize).toBe(100)
  })
})
