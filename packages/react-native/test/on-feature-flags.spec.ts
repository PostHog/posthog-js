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

  describe('reloadFeatureFlagsAsync', () => {
    it('resolves with the enabled flags of a successful reload', async () => {
      posthog = newPostHog()
      await posthog.ready()

      await expect(posthog.reloadFeatureFlagsAsync()).resolves.toEqual(loaded(false))
    })

    it('resolves with the last known flags and errorsLoading true when the reload fails', async () => {
      posthog = newPostHog()
      await posthog.ready()
      await posthog.reloadFeatureFlagsAsync()

      flagsStatus = 500

      await expect(posthog.reloadFeatureFlagsAsync()).resolves.toEqual(loaded(true))
    })
  })

  describe('getAllFeatureFlags()', () => {
    it('returns undefined before any flags are cached', async () => {
      posthog = newPostHog()
      await posthog.ready()

      expect(posthog.getAllFeatureFlags()).toBeUndefined()

      flagsStatus = 500
      await posthog.reloadFeatureFlagsAsync()

      expect(posthog.getAllFeatureFlags()).toBeUndefined()
    })

    it('returns an empty list once a load returns no flags, also after a later load fails', async () => {
      ;(globalThis as any).window.fetch = vi.fn(async () => ({
        status: flagsStatus,
        json: () => Promise.resolve({ featureFlags: {} }),
        text: () => Promise.resolve(''),
      }))
      posthog = newPostHog()
      await posthog.ready()
      await posthog.reloadFeatureFlagsAsync()

      expect(posthog.getAllFeatureFlags()).toEqual([])

      flagsStatus = 500
      await posthog.reloadFeatureFlagsAsync()

      expect(posthog.getAllFeatureFlags()).toEqual([])
    })

    it('stays undefined after a restart when no load has succeeded', async () => {
      flagsStatus = 500
      posthog = newPostHog()
      await posthog.ready()
      await posthog.reloadFeatureFlagsAsync()
      await posthog.shutdown()

      posthog = newPostHog()
      await posthog.ready()

      expect(posthog.getAllFeatureFlags()).toBeUndefined()

      flagsStatus = 200
      await posthog.reloadFeatureFlagsAsync()

      expect(posthog.getAllFeatureFlags()?.map(({ key }) => key)).toEqual(['beta-ui', 'checkout', 'old-ui', 'empty'])
    })

    it('returns bootstrapped flags when a load fails', async () => {
      flagsStatus = 500
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        flushInterval: 0,
        preloadFeatureFlags: false,
        fetchRetryCount: 0,
        bootstrap: { featureFlags: { bootstrapped: true } },
      })
      await posthog.ready()
      await posthog.reloadFeatureFlagsAsync()

      expect(posthog.getAllFeatureFlags()?.map(({ key }) => key)).toEqual(['bootstrapped'])
    })

    it('returns the loaded flags', async () => {
      posthog = newPostHog()
      await posthog.ready()
      await posthog.reloadFeatureFlagsAsync()

      expect(posthog.getAllFeatureFlags()?.map(({ key, enabled }) => [key, enabled])).toEqual([
        ['beta-ui', true],
        ['checkout', true],
        ['old-ui', false],
        ['empty', false],
      ])
    })
  })

  describe('flags whose variant is an empty string', () => {
    it('read as disabled in getFeatureFlagResult() and getAllFeatureFlags()', async () => {
      posthog = newPostHog()
      await posthog.ready()
      await posthog.reloadFeatureFlagsAsync()

      expect(posthog.getFeatureFlagResult('empty', { sendFeatureFlagEvent: false })).toMatchObject({
        enabled: false,
        variant: '',
      })
      expect(posthog.getAllFeatureFlags()?.find((result) => result.key === 'empty')).toMatchObject({
        enabled: false,
      })
      expect(posthog.isFeatureEnabled('empty')).toBe(false)
    })

    it('are left out of $active_feature_flags, like disabled flags', async () => {
      posthog = newPostHog()
      await posthog.ready()
      await posthog.reloadFeatureFlagsAsync()

      const properties = (posthog as any).getCommonEventProperties()

      expect(properties.$active_feature_flags).toEqual(['beta-ui', 'checkout'])
      expect(properties['$feature/empty']).toBe('')
    })
  })

  describe('bootstrap', () => {
    const syncStorage = (): PostHogCustomStorage => {
      const values: Record<string, string> = {}
      return {
        getItem: (key) => values[key] ?? null,
        setItem: (key, value) => {
          values[key] = value
        },
      }
    }

    it('keeps a bootstrapped string payload a string', async () => {
      posthog = new PostHog('test-token', {
        customStorage: syncStorage(),
        flushInterval: 0,
        preloadFeatureFlags: false,
        bootstrap: { featureFlags: { numeric: true }, featureFlagPayloads: { numeric: '123' } },
      })
      await posthog.ready()

      expect(posthog.getFeatureFlagResult('numeric', { sendFeatureFlagEvent: false })?.payload).toBe('123')
    })

    it('calls a listener added right after construction once with the bootstrapped flags', async () => {
      posthog = new PostHog('test-token', {
        customStorage: syncStorage(),
        flushInterval: 0,
        preloadFeatureFlags: false,
        bootstrap: { featureFlags: { 'beta-ui': true, checkout: 'test', 'old-ui': false } },
      })
      const listener = vi.fn()

      posthog.onFeatureFlags(listener)
      await posthog.ready()

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(loaded(false))
    })
  })
})
