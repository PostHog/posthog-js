/** @vitest-environment jsdom */
import React from 'react'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { useNavigationTracker } from '../src/hooks/useNavigationTracker'
import { PostHogProvider } from '../src/PostHogProvider'
import { PostHog } from '../src/posthog-rn'

const mock = vi.hoisted(() => ({ state: undefined as any, navigation: undefined as any }))
vi.mock('../src/optional/OptionalReactNativeNavigation', () => ({
  OptionalReactNativeNavigation: {
    useNavigationState: (selector: (state: any) => any) => selector(mock.state),
    useNavigation: () => mock.navigation,
  },
}))

let client: PostHog
beforeEach(() => {
  vi.useFakeTimers()
  client = new PostHog('test-token', { disabled: true, persistence: 'memory' })
  vi.spyOn(client, 'screen').mockResolvedValue(undefined)
  mock.state = { index: 0, routes: [{ name: 'Home' }] }
  mock.navigation = {
    isReady: vi.fn(() => true),
    getCurrentRoute: vi.fn(() => mock.state.routes[mock.state.index]),
  }
})
afterEach(async () => {
  cleanup()
  await client.shutdown()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useNavigationTracker', () => {
  it('tracks the initial route and index-only tab transitions with the same routes array', () => {
    mock.state.routes.push({ name: 'Settings' })
    const { rerender } = renderHook(() => useNavigationTracker(undefined, undefined, client))
    expect(client.screen).toHaveBeenLastCalledWith('Home', undefined)
    mock.state = { ...mock.state, index: 1 }
    rerender()
    expect(client.screen).toHaveBeenLastCalledWith('Settings', undefined)
    expect(client.screen).toHaveBeenCalledTimes(2)
  })

  it('maps the focused leaf returned by getCurrentRoute rather than the subscribed parent route', () => {
    const params = { id: 'private-id' }
    const focusedRoute = { name: 'users/[id]', params }
    mock.state.routes = [
      {
        name: 'Root',
        state: {
          index: 0,
          routes: [
            { name: 'Tabs', state: { index: 1, routes: [{ name: 'Home' }, focusedRoute] } },
            { name: 'Inactive' },
          ],
        },
      },
    ]
    mock.navigation.getCurrentRoute.mockReturnValue(focusedRoute)
    const routeToName = vi.fn(() => 'Redacted screen')
    const routeToProperties = vi.fn(() => ({ safe: true }))
    renderHook(() => useNavigationTracker({ routeToName, routeToProperties }, undefined, client))
    expect(routeToName).toHaveBeenCalledWith('users/[id]', params)
    expect(routeToProperties).toHaveBeenCalledWith('Redacted screen', params)
    expect(client.screen).toHaveBeenCalledWith('Redacted screen', { safe: true })
  })

  it('does not capture screens during server rendering', () => {
    const Tracker = (): null => {
      useNavigationTracker(undefined, undefined, client)
      return null
    }
    renderToString(<Tracker />)
    expect(client.screen).not.toHaveBeenCalled()
  })

  it('does not capture until navigation is ready and state updates', () => {
    mock.navigation.isReady.mockReturnValue(false)
    const { rerender } = renderHook(() => useNavigationTracker(undefined, undefined, client))
    expect(client.screen).not.toHaveBeenCalled()
    mock.navigation.isReady.mockReturnValue(true)
    mock.state = { ...mock.state }
    rerender()
    expect(client.screen).toHaveBeenCalledWith('Home', undefined)
  })

  it('supports a ready root ref and older navigation without isReady', () => {
    delete mock.navigation.isReady
    renderHook(() => useNavigationTracker(undefined, { current: mock.navigation } as any, client))
    expect(client.screen).toHaveBeenCalledWith('Home', undefined)
  })

  it('does not capture without a navigation object or current route', () => {
    mock.navigation = undefined
    const { rerender } = renderHook(() => useNavigationTracker(undefined, undefined, client))
    expect(client.screen).not.toHaveBeenCalled()
    mock.navigation = { getCurrentRoute: () => undefined }
    rerender()
    expect(client.screen).not.toHaveBeenCalled()
  })

  it('retries initial tracking once when state is not yet available', () => {
    mock.state = undefined
    mock.navigation.getCurrentRoute.mockReturnValue({ name: 'Initial' })
    renderHook(() => useNavigationTracker(undefined, undefined, client))
    expect(client.screen).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(client.screen).toHaveBeenCalledWith('Initial', undefined)
  })

  it('cancels the pending initial retry on unmount', () => {
    mock.state = undefined
    mock.navigation.getCurrentRoute.mockReturnValue({ name: 'Unmounted' })
    const { unmount } = renderHook(() => useNavigationTracker(undefined, undefined, client))
    unmount()
    act(() => {
      vi.runAllTimers()
    })
    expect(client.screen).not.toHaveBeenCalled()
  })

  it.each([false, { captureScreens: false }])('preserves provider screen opt-out %j', (autocapture) => {
    render(
      <PostHogProvider client={client} autocapture={autocapture}>
        <div />
      </PostHogProvider>
    )
    act(() => {
      vi.runAllTimers()
    })
    expect(client.screen).not.toHaveBeenCalled()
  })
})
