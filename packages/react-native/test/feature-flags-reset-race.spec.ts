import { PostHog, PostHogCustomStorage } from '../src'
import { Linking, AppState } from 'react-native'

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

describe('PostHog RN feature flags across reset()', () => {
  vi.useRealTimers()

  let posthog: PostHog
  let cache: any = {}
  let mockStorage: PostHogCustomStorage
  let flagResponses: ((body: unknown) => void)[]

  beforeEach(() => {
    flagResponses = []
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
      if (url.includes('/flags')) {
        const body = await new Promise((resolve) => flagResponses.push(resolve))
        return { status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve('') }
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
    flagResponses.forEach((respond) => respond({ featureFlags: {} }))
    await posthog.shutdown()
  })

  it("does not store or replay a response requested before reset() to the next user's listeners", async () => {
    posthog = new PostHog('test-token', {
      customStorage: mockStorage,
      flushInterval: 0,
      preloadFeatureFlags: false,
      fetchRetryCount: 0,
    })
    await posthog.ready()

    const previousUser = posthog.reloadFeatureFlagsAsync()
    await vi.waitFor(() => expect(flagResponses).toHaveLength(1))
    posthog.reset()
    flagResponses[0]({ featureFlags: { 'private-entitlement': 'admin' } })
    await previousUser

    const listener = vi.fn()
    posthog.onFeatureFlags(listener)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(posthog.getFeatureFlag('private-entitlement')).toBeUndefined()
    expect(listener).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(flagResponses).toHaveLength(2))
    flagResponses[1]({ featureFlags: { beta: true } })
    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith({ flags: ['beta'], variants: { beta: true }, errorsLoading: false })
    )
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
