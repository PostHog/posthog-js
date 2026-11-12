import { PostHog, PostHogCustomStorage } from '../src'
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
          json: () => Promise.resolve({ featureFlags: { 'beta-ui': true } }),
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

  it('reports a successful load with errorsLoading false', async () => {
    posthog = newPostHog()
    await posthog.ready()
    const listener = vi.fn()
    posthog.onFeatureFlags(listener)

    await posthog.reloadFeatureFlagsAsync()

    expect(listener).toHaveBeenLastCalledWith({ 'beta-ui': true }, { errorsLoading: false })
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

    expect(listener).toHaveBeenLastCalledWith({ 'beta-ui': true }, { errorsLoading: false })
  })

  it('reports a failed load with the last known flags and errorsLoading true', async () => {
    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    const listener = vi.fn()
    posthog.onFeatureFlags(listener)

    flagsStatus = 500
    await posthog.reloadFeatureFlagsAsync()

    expect(listener).toHaveBeenLastCalledWith({ 'beta-ui': true }, { errorsLoading: true })
  })

  it('reports a failed first load with no flags and errorsLoading true', async () => {
    flagsStatus = 500
    posthog = newPostHog()
    await posthog.ready()
    const listener = vi.fn()
    posthog.onFeatureFlags(listener)

    await posthog.reloadFeatureFlagsAsync()

    expect(listener).toHaveBeenLastCalledWith({}, { errorsLoading: true })
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

    expect(listener).toHaveBeenLastCalledWith({ 'beta-ui': true }, { errorsLoading: false })
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
})
