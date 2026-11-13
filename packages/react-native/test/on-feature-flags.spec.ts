import { PostHog, PostHogCustomStorage, PostHogPersistedProperty } from '../src'
import { Linking, AppState } from 'react-native'

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

describe('PostHog RN onFeatureFlags', () => {
  vi.useRealTimers()

  let posthog: PostHog
  let cache: any = {}
  let mockStorage: PostHogCustomStorage
  let flagsStatus: number

  beforeEach(() => {
    flagsStatus = 200
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
      if (url.includes('/flags')) {
        return {
          status: flagsStatus,
          json: () =>
            Promise.resolve({ featureFlags: { 'beta-ui': true, checkout: 'test', 'old-ui': false, empty: '' } }),
          text: () => Promise.resolve(''),
        }
      }
      return { status: 200, json: () => Promise.resolve({ status: 'ok' }) }
    })

    cache = {}
    mockStorage = {
      getItem: async (key) => cache[key] || null,
      setItem: async (key, value) => {
        cache[key] = value
      },
    }
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  const newPostHog = (): PostHog =>
    new PostHog('test-token', {
      customStorage: mockStorage,
      flushInterval: 0,
      preloadFeatureFlags: false,
      fetchRetryCount: 0,
    })

  // Disabled flags and empty variants are left out.
  const loaded = (errorsLoading: boolean) => ({
    flags: ['beta-ui', 'checkout'],
    variants: { 'beta-ui': true, checkout: 'test' },
    errorsLoading,
  })

  it('reports the enabled flags of a successful load with errorsLoading false', async () => {
    posthog = newPostHog()
    await posthog.ready()
    const listener = vi.fn()
    posthog.onFeatureFlags(listener)

    await posthog.reloadFeatureFlagsAsync()

    expect(listener).toHaveBeenLastCalledWith(loaded(false))
  })

  it('keeps notifying other listeners and finishes the load when a listener throws', async () => {
    posthog = newPostHog()
    await posthog.ready()
    posthog.onFeatureFlags(() => {
      throw new Error('boom')
    })
    const listener = vi.fn()
    posthog.onFeatureFlags(listener)

    await expect(posthog.reloadFeatureFlagsAsync()).resolves.toBeDefined()

    expect(listener).toHaveBeenLastCalledWith(loaded(false))
  })

  it('reports a failed load with the last known flags and errorsLoading true', async () => {
    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    const listener = vi.fn()
    posthog.onFeatureFlags(listener)

    flagsStatus = 500
    await posthog.reloadFeatureFlagsAsync()

    expect(listener).toHaveBeenLastCalledWith(loaded(true))
  })

  it('reports a failed first load with no flags and errorsLoading true', async () => {
    flagsStatus = 500
    posthog = newPostHog()
    await posthog.ready()
    const listener = vi.fn()
    posthog.onFeatureFlags(listener)

    await posthog.reloadFeatureFlagsAsync()

    expect(listener).toHaveBeenLastCalledWith({ flags: [], variants: {}, errorsLoading: true })
  })

  it('clears errorsLoading once a later load succeeds', async () => {
    flagsStatus = 500
    posthog = newPostHog()
    await posthog.ready()
    const listener = vi.fn()
    posthog.onFeatureFlags(listener)
    await posthog.reloadFeatureFlagsAsync()

    flagsStatus = 200
    await posthog.reloadFeatureFlagsAsync()

    expect(listener).toHaveBeenLastCalledWith(loaded(false))
  })

  it('stops calling back after unsubscribing', async () => {
    posthog = newPostHog()
    await posthog.ready()
    const listener = vi.fn()
    const unsubscribe = posthog.onFeatureFlags(listener)

    unsubscribe()
    await posthog.reloadFeatureFlagsAsync()

    expect(listener).not.toHaveBeenCalled()
  })

  it('calls a listener added after a load once with the current values, after registering returns', async () => {
    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    const listener = vi.fn()

    posthog.onFeatureFlags(listener)
    expect(listener).not.toHaveBeenCalled()
    await Promise.resolve()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(loaded(false))
  })

  it('does not call a listener added before any load until flags load', async () => {
    posthog = newPostHog()
    await posthog.ready()
    const listener = vi.fn()

    posthog.onFeatureFlags(listener)
    await Promise.resolve()

    expect(listener).not.toHaveBeenCalled()
  })

  it('skips the catch-up call when a load already reached the listener', async () => {
    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    const listener = vi.fn()

    posthog.onFeatureFlags(listener)
    posthog.updateFlags({ 'beta-ui': true })
    await Promise.resolve()

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('skips the catch-up call when unsubscribed before it runs', async () => {
    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    const listener = vi.fn()

    posthog.onFeatureFlags(listener)()
    await Promise.resolve()

    expect(listener).not.toHaveBeenCalled()
  })

  it('does not catch up a listener added after reset() until the next load', async () => {
    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    flagsStatus = 500
    posthog.reset()
    const listener = vi.fn()

    posthog.onFeatureFlags(listener)
    await Promise.resolve()

    expect(listener).not.toHaveBeenCalled()
  })

  it('does not catch up a listener when reset() runs in the same tick it was added', async () => {
    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    const listener = vi.fn()

    posthog.onFeatureFlags(listener)
    posthog.reset()
    await Promise.resolve()

    expect(listener).not.toHaveBeenCalled()
  })

  it('clears feature flag overrides saved by 4.x when it starts', async () => {
    const cached = new PostHog('test-token', {
      customStorage: mockStorage,
      flushInterval: 0,
      preloadFeatureFlags: false,
    })
    await cached.ready()
    ;(cached as any).setPersistedProperty(PostHogPersistedProperty.OverrideFeatureFlags, { 'beta-ui': false })
    await cached.shutdown()

    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()

    expect(posthog.getFeatureFlag('beta-ui')).toBe(true)
  })
})
