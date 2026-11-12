/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useActiveFeatureFlags } from '../src/hooks/useActiveFeatureFlags'
import { useFeatureFlagEnabled } from '../src/hooks/useFeatureFlagEnabled'
import { useFeatureFlagPayload } from '../src/hooks/useFeatureFlagPayload'
import { useFeatureFlags } from '../src/hooks/useFeatureFlags'
import { useFeatureFlagVariantKey } from '../src/hooks/useFeatureFlagVariantKey'
import type { PostHog } from '../src/posthog-rn'
import type { PostHogFeatureFlagsLoaded } from '../src/types'

describe('feature flag hooks', () => {
  let listeners: ((loaded: PostHogFeatureFlagsLoaded) => void)[]
  let featureFlags: Record<string, boolean | string>
  let posthog: PostHog

  const notify = (): void => {
    const enabled = Object.entries(featureFlags).filter(
      ([, value]) => value === true || (typeof value === 'string' && value !== '')
    )
    act(() =>
      listeners.forEach((listener) =>
        listener({ flags: enabled.map(([key]) => key), variants: Object.fromEntries(enabled), errorsLoading: false })
      )
    )
  }

  beforeEach(() => {
    listeners = []
    featureFlags = {}
    posthog = {
      isFeatureEnabled: vi.fn((key: string) => (key in featureFlags ? !!featureFlags[key] : undefined)),
      getFeatureFlag: vi.fn((key: string) => featureFlags[key]),
      getFeatureFlagResult: vi.fn((key: string) =>
        key in featureFlags ? { key, payload: { color: 'blue' } } : undefined
      ),
      getFeatureFlagDetails: vi.fn(() => ({ featureFlags })),
      onFeatureFlags: vi.fn((listener: (loaded: PostHogFeatureFlagsLoaded) => void) => {
        listeners.push(listener)
        return () => {}
      }),
    } as unknown as PostHog
  })

  it('useFeatureFlagEnabled returns the default until the flag has a value, then follows loads', () => {
    const { result } = renderHook(() => useFeatureFlagEnabled('beta', false, posthog))
    expect(result.current).toBe(false)

    featureFlags = { beta: true }
    notify()

    expect(result.current).toBe(true)
    expect(posthog.isFeatureEnabled).toHaveBeenLastCalledWith('beta')
  })

  it('useFeatureFlagEnabled returns undefined for an unknown flag without a default', () => {
    const { result } = renderHook(() => useFeatureFlagEnabled('beta', undefined, posthog))

    expect(result.current).toBeUndefined()
  })

  it('useFeatureFlagVariantKey follows the flag value', () => {
    featureFlags = { checkout: 'control' }
    const { result } = renderHook(() => useFeatureFlagVariantKey('checkout', posthog))
    expect(result.current).toBe('control')

    featureFlags = { checkout: 'test' }
    notify()

    expect(result.current).toBe('test')
    expect(posthog.getFeatureFlag).toHaveBeenLastCalledWith('checkout')
  })

  it('useFeatureFlagPayload reads the payload without sending $feature_flag_called', () => {
    featureFlags = { checkout: 'test' }
    const { result } = renderHook(() => useFeatureFlagPayload('checkout', posthog))

    expect(result.current).toEqual({ color: 'blue' })
    expect(posthog.getFeatureFlagResult).toHaveBeenCalledWith('checkout', { sendFeatureFlagEvent: false })
  })

  it('useActiveFeatureFlags lists only enabled flags and follows loads', () => {
    featureFlags = { beta: true, off: false, empty: '', checkout: 'test' }
    const { result } = renderHook(() => useActiveFeatureFlags(posthog))
    expect(result.current).toEqual(['beta', 'checkout'])

    featureFlags = { beta: false, checkout: 'test' }
    notify()

    expect(result.current).toEqual(['checkout'])
  })

  it('does not reread all feature flags on an unrelated rerender', () => {
    featureFlags = { beta: true }
    const { rerender } = renderHook(() => useFeatureFlags(posthog))
    ;(posthog.getFeatureFlagDetails as vi.Mock).mockClear()

    rerender()

    expect(posthog.getFeatureFlagDetails).not.toHaveBeenCalled()
  })
})
