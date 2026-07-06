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

  it('ignores screen with case-insensitive and normalized check', () => {
    const mockRoute = { name: '$&Home', params: {} }
    mockUseNavigationState.mockImplementation((cb) => cb({ routes: [mockRoute] }))
    mockUseNavigation.mockReturnValue({ isReady: () => true, getCurrentRoute: () => mockRoute })

    renderHook(
      () =>
        useNavigationTracker(
          {
            ignoreScreenNames: ['$HOME'],
          },
          undefined,
          mockPostHog
        ),
      { wrapper }
    )

    expect(mockPostHog.screen).not.toHaveBeenCalled()
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
})
