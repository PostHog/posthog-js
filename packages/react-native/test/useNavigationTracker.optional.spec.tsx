/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react'
import { useNavigationTracker } from '../src/hooks/useNavigationTracker'
import type { PostHog } from '../src/posthog-rn'

vi.mock('../src/optional/OptionalReactNativeNavigation', () => ({ OptionalReactNativeNavigation: undefined }))

it('does nothing when the optional navigation package is not installed', () => {
  const screen = vi.fn()
  const { unmount } = renderHook(() => useNavigationTracker(undefined, undefined, { screen } as unknown as PostHog))
  unmount()
  expect(screen).not.toHaveBeenCalled()
})
