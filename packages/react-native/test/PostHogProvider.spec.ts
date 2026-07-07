/** @jest-environment jsdom */
const mockViewProps = jest.fn()
let mockTouchCallback: any = null

jest.mock('react', () => {
  const actualReact = jest.requireActual('react')
  return {
    ...actualReact,
    useCallback: (fn: any, deps: any) => {
      const fnStr = fn.toString()
      if (fnStr.includes('captureTouches') || fnStr.includes('autocaptureFromTouchEvent')) {
        mockTouchCallback = fn
      }
      return actualReact.useCallback(fn, deps)
    },
  }
})

const mockAutocaptureFromTouchEvent = jest.fn()
jest.mock('../src/autocapture', () => {
  const actual = jest.requireActual('../src/autocapture')
  return {
    ...actual,
    autocaptureFromTouchEvent: (...args: any[]) => mockAutocaptureFromTouchEvent(...args),
  }
})

import React, { useEffect } from 'react'
import { render, cleanup } from '@testing-library/react'

import { PostHogProvider } from '../src/PostHogProvider'
import { usePostHog } from '../src/hooks/usePostHog'
import type { PostHog } from '../src/posthog-rn'

// jest-expo's full preset chain pulls in TurboModule code that explodes under jsdom
// (see test/SurveyModal.spec.tsx), so we provide a minimal manual mock instead.
jest.mock('react-native', () => {
  const RealReact = jest.requireActual('react')
  const View = RealReact.forwardRef(({ children, ...rest }: any, ref: any) => {
    mockViewProps(rest)
    return RealReact.createElement('div', { ref, ...rest }, children)
  })
  return {
    View,
    Platform: {
      OS: 'ios',
      select: (objs: any) => objs.ios ?? objs.default,
    },
    AppState: {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      currentState: 'active',
    },
    Linking: {
      getInitialURL: jest.fn(() => Promise.resolve(null)),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
    Dimensions: {
      get: jest.fn(() => ({ width: 375, height: 812 })),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
  }
})

const mockUseNavigationState = jest.fn()
const mockUseNavigation = jest.fn()

jest.mock('@react-navigation/native', () => ({
  useNavigationState: (cb: any) => mockUseNavigationState(cb),
  useNavigation: () => mockUseNavigation(),
}))

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
        debug: jest.fn(),
        isDisabled: false,
      } as any

      render(
        React.createElement(
          PostHogProvider,
          {
            client: mockPostHog,
            autocapture: {
              captureScreens: true,
              navigation: {
                ignoreScreenNames: ['surveys', '+not-found'],
              },
            },
          },
          React.createElement(CaptureClient, { onClient })
        )
      )

      jest.advanceTimersByTime(1)

      expect(mockPostHog.screen).not.toHaveBeenCalledWith('surveys', undefined)
      expect(mockPostHog.screen).not.toHaveBeenCalledWith()
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
        debug: jest.fn(),
        isDisabled: false,
      } as any

      render(
        React.createElement(
          PostHogProvider,
          {
            client: mockPostHog,
            autocapture: {
              captureScreens: true,
              navigation: {
                ignoreScreenNames: ['surveys'],
              },
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
        debug: jest.fn(),
        isDisabled: false,
      } as any

      render(
        React.createElement(
          PostHogProvider,
          {
            client: mockPostHog,
            autocapture: {
              captureScreens: true,
              navigation: {
                ignoreScreenNames: [],
              },
            },
          },
          React.createElement(CaptureClient, { onClient })
        )
      )

      jest.advanceTimersByTime(1)

      expect(mockPostHog.screen).toHaveBeenCalledWith('home', undefined)
    })

    it('should warn when both client and apiKey are provided', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      const mockPostHog = {
        debug: jest.fn(),
      } as any

      render(
        React.createElement(
          PostHogProvider,
          { apiKey: 'test-api-key', client: mockPostHog },
          React.createElement('div', null, 'Test')
        )
      )

      expect(consoleSpy).toHaveBeenCalledWith(
        'You have provided both a client and an apiKey to PostHogProvider. The apiKey will be ignored in favour of the client.'
      )
      consoleSpy.mockRestore()
    })

    describe('touch events autocapture', () => {
      beforeEach(() => {
        mockViewProps.mockClear()
        mockTouchCallback = null
        mockAutocaptureFromTouchEvent.mockClear()
      })

      it('does not pass onTouchEndCapture when captureTouches is false', () => {
        const mockPostHog = {
          debug: jest.fn(),
        } as any

        render(
          React.createElement(
            PostHogProvider,
            {
              client: mockPostHog,
              autocapture: {
                captureTouches: false,
              },
            },
            React.createElement('div', null, 'Test')
          )
        )

        expect(mockViewProps).toHaveBeenCalled()
        const lastProps = mockViewProps.mock.calls[mockViewProps.mock.calls.length - 1][0]
        expect(lastProps.onTouchEndCapture).toBeUndefined()
      })

      it('passes onTouchEndCapture and handles callbacks correctly', () => {
        const mockPostHog = {
          debug: jest.fn(),
        } as any

        const { rerender } = render(
          React.createElement(
            PostHogProvider,
            {
              client: mockPostHog,
              autocapture: {
                captureTouches: true,
              },
            },
            React.createElement('div', null, 'Test')
          )
        )

        expect(mockViewProps).toHaveBeenCalled()
        const lastProps = mockViewProps.mock.calls[mockViewProps.mock.calls.length - 1][0]
        expect(lastProps.onTouchEndCapture).toBeDefined()

        // 1. Test when captureTouches is true and type is 'end'
        const mockEvent = { _targetInst: {} } as any
        expect(mockTouchCallback).toBeDefined()
        mockTouchCallback('end', mockEvent)
        expect(mockAutocaptureFromTouchEvent).toHaveBeenCalledWith(mockEvent, mockPostHog, { captureTouches: true })

        // Reset mock
        mockAutocaptureFromTouchEvent.mockClear()

        // 2. Test when captureTouches is true but type is not 'end'
        mockTouchCallback('start', mockEvent)
        expect(mockAutocaptureFromTouchEvent).not.toHaveBeenCalled()

        // 3. Test when captureTouches is false
        // Rerender with captureTouches set to false
        rerender(
          React.createElement(
            PostHogProvider,
            {
              client: mockPostHog,
              autocapture: {
                captureTouches: false,
              },
            },
            React.createElement('div', null, 'Test')
          )
        )

        // The callback should be updated to a version where captureTouches is false in its closure
        expect(mockTouchCallback).toBeDefined()
        mockTouchCallback('end', mockEvent)
        expect(mockAutocaptureFromTouchEvent).not.toHaveBeenCalled()
      })
    })
  })
})
