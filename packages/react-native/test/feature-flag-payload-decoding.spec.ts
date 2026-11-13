import { PostHog, PostHogCustomStorage } from '../src'
import { Linking, AppState } from 'react-native'

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

describe('PostHog RN feature flag payload decoding', () => {
  vi.useRealTimers()

  let posthog: PostHog
  let cache: any = {}
  let mockStorage: PostHogCustomStorage
  let serializedPayload: string

  beforeEach(() => {
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
      if (url.includes('/flags')) {
        return {
          status: 200,
          json: () =>
            Promise.resolve({
              flags: {
                checkout: {
                  key: 'checkout',
                  enabled: true,
                  variant: 'blue',
                  metadata: { id: 1, version: 1, payload: serializedPayload },
                },
              },
            }),
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

  const loadFlags = async (payload: string): Promise<void> => {
    serializedPayload = payload
    posthog = new PostHog('test-token', { customStorage: mockStorage, flushInterval: 0, preloadFeatureFlags: false })
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
  }

  it.each(['{broken', '', '   '])('reads a malformed payload %j as null without changing the flag', async (payload) => {
    await loadFlags(payload)

    expect(posthog.getFeatureFlagResult('checkout', { sendFeatureFlagEvent: false })).toEqual({
      key: 'checkout',
      enabled: true,
      variant: 'blue',
      payload: null,
    })
    expect(posthog.getAllFeatureFlags()).toEqual([{ key: 'checkout', enabled: true, variant: 'blue', payload: null }])
    expect(posthog.getFeatureFlag('checkout')).toEqual('blue')
  })

  it('reads a malformed payload as null in getFeatureFlagDetails()', async () => {
    await loadFlags('{broken')

    expect(posthog.getFeatureFlagDetails()?.featureFlagPayloads).toEqual({ checkout: null })
  })

  it('keeps a malformed payload null after a merging updateFlags()', async () => {
    await loadFlags('{broken')

    posthog.updateFlags({ other: true }, undefined, { merge: true })

    expect(posthog.getFeatureFlagResult('checkout', { sendFeatureFlagEvent: false })?.payload).toBeNull()
  })

  it.each([
    ['{"cta":"Try now"}', { cta: 'Try now' }],
    ['""', ''],
    ['false', false],
    ['0', 0],
    ['null', null],
  ])('decodes the valid payload %s', async (payload, expected) => {
    await loadFlags(payload)

    expect(posthog.getFeatureFlagResult('checkout', { sendFeatureFlagEvent: false })?.payload).toEqual(expected)
  })
})
