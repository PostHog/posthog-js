import { useCallback, useEffect } from 'react'
import { OptionalReactNativeNavigation } from '../optional/OptionalReactNativeNavigation'
import type { PostHog } from '../posthog-rn'
import { PostHogAutocaptureNavigationTrackerOptions } from '../types'
import { usePostHog } from './usePostHog'
import { PostHogNavigationRef } from '../types'

function _useNavigationTrackerDisabled(): void {
  return
}

function _useNavigationTracker(
  options?: PostHogAutocaptureNavigationTrackerOptions,
  navigationRef?: PostHogNavigationRef,
  client?: PostHog
): void {
  const contextClient = usePostHog()
  const posthog = client || contextClient

  if (!OptionalReactNativeNavigation) {
    // NOTE: This is taken care of by the export, but we keep this here for TS
    throw new Error('No OptionalReactNativeNavigation')
  }

  const routes = OptionalReactNativeNavigation.useNavigationState((state) => state?.routes)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const navigation = navigationRef || OptionalReactNativeNavigation.useNavigation()

  const trackRoute = useCallback((): void => {
    if (!navigation) {
      return
    }

    let currentRoute = undefined

    // NOTE: This method is not typed correctly but is available and takes care of parsing the router state correctly
    try {
      let isReady = false
      try {
        isReady = (navigation as any).isReady()
      } catch (error) {
        // keep compatibility with older versions of react-navigation
        isReady = true
      }

      if (!isReady) {
        return
      }

      currentRoute = (navigation as any).getCurrentRoute()
    } catch (error) {
      return
    }

    if (!currentRoute) {
      return
    }

    const { state } = currentRoute
    let { name, params } = currentRoute

    if (state?.routes?.length) {
      const route = state.routes[state.routes.length - 1]
      name = route.name
      params = route.params
    }

    const currentRouteName = options?.routeToName?.(name, params) || name || 'Unknown'

    if (currentRouteName) {
      const properties = options?.routeToProperties?.(currentRouteName, params)
      posthog.screen(currentRouteName, properties)
    }
  }, [navigation, options, posthog])

  useEffect(() => {
    // NOTE: The navigation stacks may not be fully rendered initially. This means the first route can be missed (it doesn't update useNavigationState)
    // If missing we simply wait a tick and call it again.
    if (!routes) {
      setTimeout(trackRoute, 1)
      return
    }
    trackRoute()
  }, [routes, trackRoute])
}

export const useNavigationTracker = OptionalReactNativeNavigation
  ? _useNavigationTracker
  : _useNavigationTrackerDisabled
