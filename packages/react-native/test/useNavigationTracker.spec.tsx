/** @jest-environment jsdom */
import React from 'react'
import { renderHook, cleanup } from '@testing-library/react'
import { useNavigationTracker } from '../src/hooks/useNavigationTracker'
import { PostHogContext } from '../src/PostHogContext'

jest.mock('react-native', () => ({
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
}))

const mockUseNavigationState = jest.fn()
const mockUseNavigation = jest.fn()

jest.mock('@react-navigation/native', () => ({
  useNavigationState: (cb: any) => mockUseNavigationState(cb),
  useNavigation: () => mockUseNavigation(),
}))

describe('useNavigationTracker', () => {
  let mockPostHog: jest.Mocked<any>

  beforeEach(() => {
    jest.useFakeTimers()
    mockUseNavigationState.mockReset()
    mockUseNavigation.mockReset()
    mockPostHog = {
      screen: jest.fn(),
      isDisabled: false,
    }
  })

  afterEach(() => {
    jest.useRealTimers()
    cleanup()
  })

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(PostHogContext.Provider, { value: { client: mockPostHog } }, children)

  describe('screen tracking using cyrillic characters', () => {
    it('ignores screens in ignoreScreenNames', () => {
      const mockRoute = { name: 'home', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(
        () =>
          useNavigationTracker(
            {
              ignoreScreenNames: ['home'],
            },
            undefined,
            mockPostHog
          ),
        { wrapper }
      )

      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })

    it('tracks screen names not in ignoreScreenNames', () => {
      const mockRoute = { name: 'profile', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(
        () =>
          useNavigationTracker(
            {
              ignoreScreenNames: ['home'],
            },
            undefined,
            mockPostHog
          ),
        { wrapper }
      )

      expect(mockPostHog.screen).toHaveBeenCalledWith('profile', undefined)
    })

    it('tracks screens when ignoreScreenNames is missing', () => {
      const mockRoute = { name: 'home', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(() => useNavigationTracker({}, undefined, mockPostHog), { wrapper })

      expect(mockPostHog.screen).toHaveBeenCalledWith('home', undefined)
    })

    it('tracks screens when ignoreScreenNames is undefined', () => {
      const mockRoute = { name: 'home', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(() => useNavigationTracker({ ignoreScreenNames: undefined }, undefined, mockPostHog), { wrapper })

      expect(mockPostHog.screen).toHaveBeenCalledWith('home', undefined)
    })

    it('tracks screens when options and navigationRef are undefined', () => {
      const mockRoute = { name: 'home', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(() => useNavigationTracker(undefined, undefined, mockPostHog), { wrapper })

      expect(mockPostHog.screen).toHaveBeenCalledWith('home', undefined)
    })

    it('customizes route name using routeToName', () => {
      const mockRoute = { name: 'user', params: { id: '123' } }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(
        () =>
          useNavigationTracker(
            {
              ignoreScreenNames: [],
              routeToName: (name, params) => `custom-${name}-${params?.id}`,
            },
            undefined,
            mockPostHog
          ),
        { wrapper }
      )

      expect(mockPostHog.screen).toHaveBeenCalledWith('custom-user-123', undefined)
    })

    it('adds custom properties using routeToProperties', () => {
      const mockRoute = { name: 'home', params: { ref: 'email' } }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(
        () =>
          useNavigationTracker(
            {
              ignoreScreenNames: [],
              routeToProperties: (name, params) => ({ from: params?.ref }),
            },
            undefined,
            mockPostHog
          ),
        { wrapper }
      )

      expect(mockPostHog.screen).toHaveBeenCalledWith('home', { from: 'email' })
    })

    it('respects a custom navigationRef if provided', () => {
      const mockRoute = { name: 'settings', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })
      const customNavigationRef = {
        isReady: () => true,
        getCurrentRoute: () => mockRoute,
      } as any

      renderHook(
        () =>
          useNavigationTracker(
            {
              ignoreScreenNames: [],
            },
            customNavigationRef,
            mockPostHog
          ),
        { wrapper }
      )

      expect(mockUseNavigation).not.toHaveBeenCalled()
      expect(mockPostHog.screen).toHaveBeenCalledWith('settings', undefined)
    })

    it('handles useNavigation error gracefully', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      mockUseNavigation.mockImplementation(() => {
        throw new Error('Navigation hook error')
      })

      renderHook(() => useNavigationTracker({}, undefined, mockPostHog), { wrapper })

      expect(consoleErrorSpy).toHaveBeenCalledWith('useNavigation error', expect.any(Error))
      consoleErrorSpy.mockRestore()
    })

    it('returns early in trackRoute if navigation is missing', () => {
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [{ name: 'home' }] }))
      mockUseNavigation.mockReturnValue(null)

      renderHook(() => useNavigationTracker({}, undefined, mockPostHog), { wrapper })

      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })

    it('returns early in trackRoute if posthog is missing', () => {
      const mockRoute = { name: 'home', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(() => useNavigationTracker({}, undefined, undefined))

      // Should run successfully without throwing
      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })

    it('resolves currentNavigation from navigation.current ref', () => {
      const mockRoute = { name: 'dashboard', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      const customNavigationRef = {
        current: {
          isReady: () => true,
          getCurrentRoute: () => mockRoute,
        },
      } as any

      renderHook(() => useNavigationTracker({}, customNavigationRef, mockPostHog), { wrapper })

      expect(mockPostHog.screen).toHaveBeenCalledWith('dashboard', undefined)
    })

    it('keeps compatibility and sets isReady to true if isReady throws', () => {
      const mockRoute = { name: 'dashboard', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      const customNavigation = {
        isReady: () => {
          throw new Error('isReady is not a function or throws')
        },
        getCurrentRoute: () => mockRoute,
      } as any

      renderHook(() => useNavigationTracker({}, customNavigation, mockPostHog), { wrapper })

      expect(mockPostHog.screen).toHaveBeenCalledWith('dashboard', undefined)
    })

    it('returns early if isReady is false', () => {
      const mockRoute = { name: 'home', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      const customNavigation = {
        isReady: () => false,
        getCurrentRoute: () => mockRoute,
      } as any

      renderHook(() => useNavigationTracker({}, customNavigation, mockPostHog), { wrapper })

      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })

    it('returns early if getCurrentRoute throws', () => {
      const mockRoute = { name: 'home', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      const customNavigation = {
        isReady: () => true,
        getCurrentRoute: () => {
          throw new Error('getCurrentRoute error')
        },
      } as any

      renderHook(() => useNavigationTracker({}, customNavigation, mockPostHog), { wrapper })

      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })

    it('returns early if currentRoute is falsy', () => {
      const mockRoute = { name: 'home', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      const customNavigation = {
        isReady: () => true,
        getCurrentRoute: () => null,
      } as any

      renderHook(() => useNavigationTracker({}, customNavigation, mockPostHog), { wrapper })

      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })

    it('extracts name and params from nested state routes', () => {
      const mockRoute = {
        name: 'parent',
        params: { parentProp: 'parent' },
        state: {
          routes: [
            { name: 'child-1', params: { childProp: '1' } },
            { name: 'child-2', params: { childProp: '2' } },
          ],
        },
      }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      const customNavigation = {
        isReady: () => true,
        getCurrentRoute: () => mockRoute,
      } as any

      renderHook(() => useNavigationTracker({}, customNavigation, mockPostHog), { wrapper })

      expect(mockPostHog.screen).toHaveBeenCalledWith('child-2', undefined)
    })

    it('waits a tick using setTimeout if routes state is missing', () => {
      const mockRoute = { name: 'delayed-screen', params: {} }
      mockUseNavigationState.mockReturnValue(undefined)
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(() => useNavigationTracker({}, undefined, mockPostHog), { wrapper })

      // Should not be called immediately because it goes into setTimeout
      expect(mockPostHog.screen).not.toHaveBeenCalled()

      // Fast-forward time
      jest.advanceTimersByTime(1)

      expect(mockPostHog.screen).toHaveBeenCalledWith('delayed-screen', undefined)
    })
  })

  describe('screen tracking with non-cyrillic characters', () => {
    it('ignores screen names in Greek', () => {
      const mockRoute = { name: 'αρχική', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(
        () =>
          useNavigationTracker(
            {
              ignoreScreenNames: ['ΑΡΧΙΚΉ'], // uppercase Greek with correct tonos/diacritic
            },
            undefined,
            mockPostHog
          ),
        { wrapper }
      )

      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })

    it('ignores screen names in Japanese', () => {
      const mockRoute = { name: 'ホーム', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(
        () =>
          useNavigationTracker(
            {
              ignoreScreenNames: ['ホーム'],
            },
            undefined,
            mockPostHog
          ),
        { wrapper }
      )

      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })

    it('ignores screen names in Arabic', () => {
      const mockRoute = { name: 'الرئيسية', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(
        () =>
          useNavigationTracker(
            {
              ignoreScreenNames: ['الرئيسية'],
            },
            undefined,
            mockPostHog
          ),
        { wrapper }
      )

      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })

    it('ignores screen names when multiple languages used in the ignore list (Japanese and Arabic)', () => {
      const mockRoute = { name: 'ホーム', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(
        () =>
          useNavigationTracker(
            {
              ignoreScreenNames: ['ΑΡΧΙΚΉ', 'ホーム', 'الرئيسية'],
            },
            undefined,
            mockPostHog
          ),
        { wrapper }
      )

      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })

    it('does not ignore screen names that are only partial matches', () => {
      const mockRoute = { name: 'αρχική-ρυθμίσεις', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(
        () =>
          useNavigationTracker(
            {
              ignoreScreenNames: ['αρχική'],
            },
            undefined,
            mockPostHog
          ),
        { wrapper }
      )

      expect(mockPostHog.screen).toHaveBeenCalledWith('αρχική-ρυθμίσεις', undefined)
    })

    it('ignores screen names with multiple diacritics case-insensitively', () => {
      const mockRoute = { name: 'ρυθμίσεις', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(
        () =>
          useNavigationTracker(
            {
              ignoreScreenNames: ['ΡΥΘΜΊΣΕΙΣ'], // Uppercase Greek 'SETTINGS' with accent on Iota
            },
            undefined,
            mockPostHog
          ),
        { wrapper }
      )

      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })

    it('ignores screen names that contain emojis', () => {
      const mockRoute = { name: '🚀-dashboard', params: {} }
      mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
      mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

      renderHook(
        () =>
          useNavigationTracker(
            {
              ignoreScreenNames: ['🚀-dashboard'],
            },
            undefined,
            mockPostHog
          ),
        { wrapper }
      )

      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })
  })
})
