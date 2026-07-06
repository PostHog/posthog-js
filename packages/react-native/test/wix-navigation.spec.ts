import { withReactNativeNavigation } from '../src/frameworks/wix-navigation'

let mockNavigation: any = null

jest.mock('../src/optional/OptionalReactNativeNavigationWix', () => ({
  get OptionalReactNativeNavigationWix() {
    return mockNavigation
  },
}))

describe('wix-navigation', () => {
  let mockPostHog: any
  let registeredCallback: ((event: { componentName: string; passProps?: any }) => void) | null = null

  beforeEach(() => {
    jest.clearAllMocks()
    mockNavigation = null
    registeredCallback = null
    mockPostHog = {
      screen: jest.fn(),
    }
  })

  it('should return false if OptionalReactNativeNavigationWix is not available', () => {
    mockNavigation = null
    const result = withReactNativeNavigation(mockPostHog)
    expect(result).toBe(false)
    expect(mockPostHog.screen).not.toHaveBeenCalled()
  })

  describe('when OptionalReactNativeNavigationWix is available', () => {
    const registerComponentDidAppearListener = jest.fn((callback) => {
      registeredCallback = callback
      return { remove: jest.fn() }
    })

    beforeEach(() => {
      mockNavigation = {
        Navigation: {
          events: () => ({
            registerComponentDidAppearListener,
          }),
        },
      }
    })

    it('should register listener and return true', () => {
      const result = withReactNativeNavigation(mockPostHog)
      expect(result).toBe(true)
      expect(registerComponentDidAppearListener).toHaveBeenCalledTimes(1)
    })

    it('should default to capture screens if options.captureScreens is undefined', () => {
      withReactNativeNavigation(mockPostHog)
      expect(registeredCallback).toBeDefined()

      registeredCallback!({ componentName: 'HomeScreen', passProps: { id: 1 } })
      expect(mockPostHog.screen).toHaveBeenCalledWith('HomeScreen', undefined)
    })

    it('should not capture screens if options.captureScreens is false', () => {
      withReactNativeNavigation(mockPostHog, { captureScreens: false })
      expect(registeredCallback).toBeDefined()

      registeredCallback!({ componentName: 'HomeScreen', passProps: { id: 1 } })
      expect(mockPostHog.screen).not.toHaveBeenCalled()
    })

    it('should handle custom routeToName in options', () => {
      const routeToName = jest.fn((name, props) => `Custom-${name}-${props.id}`)
      withReactNativeNavigation(mockPostHog, {
        navigation: {
          routeToName,
        },
      })
      expect(registeredCallback).toBeDefined()

      registeredCallback!({ componentName: 'HomeScreen', passProps: { id: 123 } })
      expect(routeToName).toHaveBeenCalledWith('HomeScreen', { id: 123 })
      expect(mockPostHog.screen).toHaveBeenCalledWith('Custom-HomeScreen-123', undefined)
    })

    it('should handle custom routeToProperties in options', () => {
      const routeToProperties = jest.fn((name, props) => ({ screen: name, id: props.id }))
      withReactNativeNavigation(mockPostHog, {
        navigation: {
          routeToProperties,
        },
      })
      expect(registeredCallback).toBeDefined()

      registeredCallback!({ componentName: 'HomeScreen', passProps: { id: 123 } })
      expect(routeToProperties).toHaveBeenCalledWith('HomeScreen', { id: 123 })
      expect(mockPostHog.screen).toHaveBeenCalledWith('HomeScreen', { screen: 'HomeScreen', id: 123 })
    })

    it('should ignore screens specified in ignoreScreenNames', () => {
      withReactNativeNavigation(mockPostHog, {
        navigation: {
          ignoreScreenNames: ['LoginScreen'],
        },
      })
      expect(registeredCallback).toBeDefined()

      // Exact match
      registeredCallback!({ componentName: 'LoginScreen' })
      expect(mockPostHog.screen).not.toHaveBeenCalled()

      // Case-insensitive match
      registeredCallback!({ componentName: 'loginscreen' })
      expect(mockPostHog.screen).not.toHaveBeenCalled()

      // Non-ignored screen should be captured
      registeredCallback!({ componentName: 'HomeScreen' })
      expect(mockPostHog.screen).toHaveBeenCalledWith('HomeScreen', undefined)
    })

    it('should not treat differently-punctuated names as a match', () => {
      withReactNativeNavigation(mockPostHog, {
        navigation: {
          ignoreScreenNames: ['Signup-Screen'],
        },
      })
      expect(registeredCallback).toBeDefined()

      // 'SignupScreen' only matches 'Signup-Screen' if punctuation is stripped before
      // comparing, which would collide with unrelated screen names (see PR #3996 review) -
      // matching is a plain case-insensitive exact compare, so this should still be captured.
      registeredCallback!({ componentName: 'SignupScreen' })
      expect(mockPostHog.screen).toHaveBeenCalledWith('SignupScreen', undefined)
    })

    it('should fall back to Unknown if componentName is not provided and routeToName is not defined', () => {
      withReactNativeNavigation(mockPostHog)
      expect(registeredCallback).toBeDefined()

      registeredCallback!({ componentName: '' })
      expect(mockPostHog.screen).toHaveBeenCalledWith('Unknown', undefined)
    })
  })
})
