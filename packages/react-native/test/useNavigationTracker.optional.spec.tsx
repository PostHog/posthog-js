/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react'
import { useNavigationTracker } from '../src/hooks/useNavigationTracker'
import { PostHog } from '../src/posthog-rn'

vi.mock('../src/optional/OptionalReactNativeNavigation', () => ({ OptionalReactNativeNavigation: undefined }))

it('does nothing when the optional navigation package is not installed', async () => {
  const client = new PostHog('test-token', { disabled: true, persistence: 'memory' })
  const screen = vi.spyOn(client, 'screen').mockResolvedValue(undefined)
  const { unmount } = renderHook(() => useNavigationTracker(undefined, undefined, client))
  unmount()
  await client.shutdown()
  expect(screen).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})
