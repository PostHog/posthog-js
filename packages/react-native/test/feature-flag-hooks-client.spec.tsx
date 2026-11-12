/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { Linking, AppState } from 'react-native'
import { PostHog, PostHogCustomStorage, useFeatureFlagEnabled, useFeatureFlagVariantKey } from '../src'

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

describe('feature flag hooks with a real client', () => {
  vi.useRealTimers()
  let posthog: PostHog

  beforeEach(async () => {
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) =>
      url.includes('/flags')
        ? {
            status: 200,
            json: () => Promise.resolve({ featureFlags: { 'beta-ui': true } }),
            text: () => Promise.resolve(''),
          }
        : { status: 200, json: () => Promise.resolve({ status: 'ok' }) }
    )
    const cache: Record<string, any> = {}
    const storage: PostHogCustomStorage = {
      getItem: async (key) => cache[key] || null,
      setItem: async (key, value) => {
        cache[key] = value
      },
    }
    posthog = new PostHog('test-token', {
      customStorage: storage,
      flushInterval: 0,
      preloadFeatureFlags: false,
      fetchRetryCount: 0,
    })
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  it('returns the default and undefined for a flag missing from the loaded flags', async () => {
    const enabled = renderHook(() => useFeatureFlagEnabled('missing', true, posthog))
    const variant = renderHook(() => useFeatureFlagVariantKey('missing', posthog))
    await act(async () => {
      await Promise.resolve()
    })

    expect(enabled.result.current).toBe(true)
    expect(variant.result.current).toBeUndefined()
  })
})
