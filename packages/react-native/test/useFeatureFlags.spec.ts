/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react'
import { useFeatureFlag } from '../src/hooks/useFeatureFlag'
import { useFeatureFlags } from '../src/hooks/useFeatureFlags'
import type { PostHog } from '../src/posthog-rn'

describe('feature flag hooks', () => {
  it('does not reread all feature flags on an unrelated rerender', () => {
    const posthog = {
      getFeatureFlagDetails: vi.fn(() => ({ featureFlags: { 'test-flag': true } })),
      onFeatureFlags: vi.fn(() => vi.fn()),
    } as unknown as PostHog

    const { rerender } = renderHook(() => useFeatureFlags(posthog))
    ;(posthog.getFeatureFlagDetails as vi.Mock).mockClear()

    rerender()

    expect(posthog.getFeatureFlagDetails).not.toHaveBeenCalled()
  })

  it('does not reread a feature flag on an unrelated rerender', () => {
    const posthog = {
      getFeatureFlag: vi.fn(() => true),
      onFeatureFlags: vi.fn(() => vi.fn()),
    } as unknown as PostHog

    const { rerender } = renderHook(() => useFeatureFlag('test-flag', posthog))
    ;(posthog.getFeatureFlag as vi.Mock).mockClear()

    rerender()

    expect(posthog.getFeatureFlag).not.toHaveBeenCalled()
  })
})
