/*
 * Wix Navigation (react-native-navigation)
 *
 * Wix Navigation uses a very different paradigm for rendering screens, with a more imperative / config driven approach
 * Instead of hooking into the natural React lifecycle, it provides a very different API which we can hook into and use instead.
 */

import { OptionalReactNativeNavigationWix } from '../optional/OptionalReactNativeNavigationWix'
import { PostHog } from '../posthog-rn'
import { PostHogAutocaptureOptions } from '../types'

const normalizeRegex = /[^a-z0-9]/gi

export const withReactNativeNavigation = (posthog: PostHog, options: PostHogAutocaptureOptions = {}): boolean => {
  if (!OptionalReactNativeNavigationWix) {
    return false
  }

  const Navigation = OptionalReactNativeNavigationWix.Navigation

  // Equivalent of `useNavigationTracker`
  Navigation.events().registerComponentDidAppearListener(({ componentName, passProps }) => {
    if (!(options.captureScreens ?? true)) {
      return
    }

    const currentRouteName =
      options?.navigation?.routeToName?.(componentName, passProps || {}) || componentName || 'Unknown'

    if (currentRouteName) {
      const properties = options?.navigation?.routeToProperties?.(currentRouteName, passProps || {})
      const ignoreScreenNames = options?.ignoreScreenNames || []
      const normalizedScreenNames = ignoreScreenNames.map((screenName) =>
        screenName.toLowerCase()?.replace(normalizeRegex, '')
      )

      const normalizedCurrentRoute = currentRouteName.toLowerCase()?.replace(normalizeRegex, '')

    const skipScreenTracking =
        normalizedScreenNames?.length && normalizedScreenNames?.includes(normalizedCurrentRoute)

      if (skipScreenTracking) {
        return
      }

      posthog.screen(currentRouteName, properties)
    }
  })

  return true
}
