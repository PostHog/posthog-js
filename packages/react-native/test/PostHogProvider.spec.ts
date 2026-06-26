/** @jest-environment jsdom */
import React, { useEffect } from 'react'
import { render, cleanup } from '@testing-library/react'
import { AppState, Linking } from 'react-native'

import { PostHogProvider } from '../src/PostHogProvider'
import { usePostHog } from '../src/hooks/usePostHog'
import type { PostHog } from '../src/posthog-rn'

const mockUseNavigationState = jest.fn()
const mockUseNavigation = jest.fn()

jest.mock('@react-navigation/native', () => ({
  useNavigationState: (cb: any) => mockUseNavigationState(cb),
  useNavigation: () => mockUseNavigation(),
}))

Linking.getInitialURL = jest.fn(() => Promise.resolve(null))
AppState.addEventListener = jest.fn()

const CaptureClient = ({ onClient }: { onClient: (client: PostHog) => void }) => {
  const posthog = usePostHog()

  useEffect(() => {
    onClient(posthog)
  }, [onClient, posthog])

  return null
}

describe('PostHogProvider', () => {
  beforeEach(() => {
    ;(globalThis as any).window.fetch = jest.fn(async () => ({
      status: 200,
      json: () => Promise.resolve({ featureFlags: {} }),
    }))
  })

  afterEach(() => {
    cleanup()
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('should render a disabled client instead of throwing when the api key is %s', (_case, apiKey) => {
    const onClient = jest.fn()
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(() => {
        render(
          React.createElement(
            PostHogProvider,
            { apiKey, autocapture: false, options: { persistence: 'memory' } },
            React.createElement(CaptureClient, { onClient })
          )
        )
      }).not.toThrow()

      const posthog = onClient.mock.calls[0][0] as PostHog
      expect(posthog.isDisabled).toEqual(true)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "You must pass your PostHog project's api key. The client will be disabled."
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  describe('autocapture', () => {
    beforeEach(() => {
      jest.useFakeTimers()
      mockUseNavigationState.mockReset()
      mockUseNavigation.mockReset()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should ignore tracking for screen names specified in ignoreScreenNames', () => {
      const mockRoute = { name: 'surveys', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))

      const mockNavigation = {
        isReady: () => true,
        getCurrentRoute: () => mockRoute,
      }
      mockUseNavigation.mockReturnValue(mockNavigation)

      const onClient = jest.fn()
      const mockPostHog = {
        screen: jest.fn(),
        isDisabled: false,
      } as any

      render(
        React.createElement(
          PostHogProvider,
          {
            client: mockPostHog,
            autocapture: {
              captureScreens: true,
              ignoreScreenNames: ['surveys', '+not-found'],
            },
          },
          React.createElement(CaptureClient, { onClient })
        )
      )

      jest.advanceTimersByTime(1)

      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })

    it('should track screen names that are not in ignoreScreenNames', () => {
      const mockRoute = { name: 'home', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))

      const mockNavigation = {
        isReady: () => true,
        getCurrentRoute: () => mockRoute,
      }
      mockUseNavigation.mockReturnValue(mockNavigation)

      const onClient = jest.fn()
      const mockPostHog = {
        screen: jest.fn(),
        isDisabled: false,
      } as any

      render(
        React.createElement(
          PostHogProvider,
          {
            client: mockPostHog,
            autocapture: {
              captureScreens: true,
              ignoreScreenNames: ['surveys'],
            },
          },
          React.createElement(CaptureClient, { onClient })
        )
      )

      jest.advanceTimersByTime(1)

      expect(mockPostHog.screen).toHaveBeenCalledWith('home', undefined)
    })

    it('should track screen names when ignoreScreenNames is empty', () => {
      const mockRoute = { name: 'home', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))

      const mockNavigation = {
        isReady: () => true,
        getCurrentRoute: () => mockRoute,
      }
      mockUseNavigation.mockReturnValue(mockNavigation)

      const onClient = jest.fn()
      const mockPostHog = {
        screen: jest.fn(),
        isDisabled: false,
      } as any

      render(
        React.createElement(
          PostHogProvider,
          {
            client: mockPostHog,
            autocapture: {
              captureScreens: true,
              ignoreScreenNames: [],
            },
          },
          React.createElement(CaptureClient, { onClient })
        )
      )

      jest.advanceTimersByTime(1)

      expect(mockPostHog.screen).toHaveBeenCalledWith('home', undefined)
    })

    it('should track screen names containing non-alphanumeric characters', () => {
      const mockRoute = { name: '$&home', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))

      const mockNavigation = {
        isReady: () => true,
        getCurrentRoute: () => mockRoute,
      }
      mockUseNavigation.mockReturnValue(mockNavigation)

      const onClient = jest.fn()
      const mockPostHog = {
        screen: jest.fn(),
        isDisabled: false,
      } as any

      render(
        React.createElement(
          PostHogProvider,
          {
            client: mockPostHog,
            autocapture: {
              captureScreens: true,
              ignoreScreenNames: ['$HOME'],
            },
          },
          React.createElement(CaptureClient, { onClient })
        )
      )

      jest.advanceTimersByTime(1)

      expect(mockPostHog.screen).toHaveBeenCalledWith('home', undefined)
    })
  })
})
