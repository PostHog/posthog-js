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

  let routes: any = undefined
  let navigation: any = navigationRef

  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    routes = OptionalReactNativeNavigation.useNavigationState((state: any) => state?.routes)
  } catch (error) {
    // useNavigationState might not be available in static navigation setups
    // We'll rely on the navigation object to get the current route
    console.error('useNavigationState error', error)
  }

  try {
    if (!navigation) {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      navigation = OptionalReactNativeNavigation.useNavigation()
    }
  } catch (error) {
    // useNavigation hook might not be available in static navigation setups
    // Navigation tracking will be disabled in this case
    console.error('useNavigation error', error)
    return
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const trackRoute = useCallback((): void => {
    if (!navigation) {
      return
    }

    // if you create a navigation ref with createNavigationContainerRef, you need to use the current property to get the navigation object
    let currentNavigation = navigation
    if (navigation.current) {
      currentNavigation = navigation.current
    }

    let currentRoute = undefined

    // NOTE: This method is not typed correctly but is available and takes care of parsing the router state correctly
    try {
      let isReady = false
      try {
        isReady = (currentNavigation as any).isReady()
      } catch (error) {
        // keep compatibility with older versions of react-navigation
        isReady = true
      }

      if (!isReady) {
        return
      }

      currentRoute = (currentNavigation as any).getCurrentRoute()
    } catch (error) {
      // if this happens, we're not in a navigation context, so we can't track the route
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

  // eslint-disable-next-line react-hooks/rules-of-hooks
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
