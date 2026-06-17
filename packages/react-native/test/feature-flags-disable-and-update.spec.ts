import { PostHog, PostHogCustomStorage, PostHogPersistedProperty } from '../src'
import { Linking, AppState } from 'react-native'
import { wait } from './test-utils'

Linking.getInitialURL = jest.fn(() => Promise.resolve(null))
AppState.addEventListener = jest.fn()

describe('PostHog RN disableRemoteFeatureFlags and updateFlags', () => {
  jest.useRealTimers()

  let posthog: PostHog
  let cache: any = {}
  let mockStorage: PostHogCustomStorage

  const flagsCalls = (): any[][] =>
    ((globalThis as any).window.fetch as jest.Mock).mock.calls.filter(([url]: [string]) =>
      String(url).includes('/flags')
    )

  beforeEach(() => {
    ;(globalThis as any).window.fetch = jest.fn(async (url: string) => {
      let res: any = { status: 'ok' }
      if (url.includes('/flags')) {
        // The mocked server still returns flag values, proving the SDK does not store them
        res = {
          featureFlags: { 'server-flag': true },
          surveys: [{ id: 'survey-1' }],
          sessionRecording: { endpoint: '/s/' },
        }
      } else if (url.includes('/config')) {
        res = {
          hasFeatureFlags: true,
          sessionRecording: { endpoint: '/s/' },
          surveys: false,
          supportedCompression: ['gzip', 'gzip-js'],
        }
      }
      return { status: 200, json: () => Promise.resolve(res) }
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

  describe('with remote config disabled (the flags endpoint also carries config/surveys)', () => {
    const newPostHog = (): PostHog =>
      new PostHog('test-token', {
        customStorage: mockStorage,
        flushInterval: 0,
        disableRemoteConfig: true,
        disableRemoteFeatureFlags: true,
      })

    it('makes a single config request with disable_flags and never refetches on identify/reset', async () => {
      posthog = newPostHog()
      await posthog.ready()
      await wait(50)

      expect(flagsCalls()).toHaveLength(1)
      expect(JSON.parse(flagsCalls()[0][1].body)).toMatchObject({ disable_flags: true })

      posthog.identify('user-1')
      posthog.reset()
      posthog.identify('user-2')
      await wait(50)

      expect(flagsCalls()).toHaveLength(1)
    })

    it('caches surveys from the config request but does not store its flags', async () => {
      posthog = newPostHog()
      await posthog.ready()
      await wait(50)

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Surveys)).toEqual([{ id: 'survey-1' }])
      expect(posthog.getFeatureFlag('server-flag')).toEqual(undefined)
    })

    it('updateFlags values are readable back and survive a restart without any flag fetches', async () => {
      posthog = newPostHog()
      await posthog.ready()

      posthog.updateFlags({ 'local-flag': true, 'variant-flag': 'variant-a' }, { 'variant-flag': { tier: 1 } })
      await wait(50)

      expect(posthog.getFeatureFlag('local-flag')).toEqual(true)
      expect(posthog.getFeatureFlag('variant-flag')).toEqual('variant-a')
      expect(posthog.getFeatureFlagPayload('variant-flag')).toEqual({ tier: 1 })

      // reload is a no-op resolving with the locally supplied flags
      const flags = await posthog.reloadFeatureFlagsAsync()
      expect(flags).toEqual({ 'local-flag': true, 'variant-flag': 'variant-a' })

      await posthog.shutdown()
      ;((globalThis as any).window.fetch as jest.Mock).mockClear()

      // "restart": a new instance over the same storage reads the flags with no network
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        flushInterval: 0,
        disableRemoteConfig: true,
        preloadFeatureFlags: false,
        disableRemoteFeatureFlags: true,
      })
      await posthog.ready()
      await wait(50)

      expect(posthog.getFeatureFlag('local-flag')).toEqual(true)
      expect(posthog.getFeatureFlagPayload('variant-flag')).toEqual({ tier: 1 })
      expect(flagsCalls()).toHaveLength(0)
    })
  })

  describe('with remote config enabled', () => {
    it('fetches remote config but never calls the flags endpoint', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        flushInterval: 0,
        disableRemoteFeatureFlags: true,
      })
      await posthog.ready()
      await wait(50)

      const configCalls = ((globalThis as any).window.fetch as jest.Mock).mock.calls.filter(([url]: [string]) =>
        String(url).includes('/array/')
      )
      expect(configCalls).toHaveLength(1)
      expect(flagsCalls()).toHaveLength(0)

      posthog.identify('user-1')
      await wait(50)
      expect(flagsCalls()).toHaveLength(0)
    })
  })
})
