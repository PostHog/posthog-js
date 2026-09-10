import { isEmptyString, trySafe, type PostHogEventProperties } from '@posthog/core'
import { AppState, Platform } from 'react-native'
import { OptionalExpoUpdates } from '../optional/OptionalExpoUpdates'

const knownString = (value: unknown): value is string =>
  typeof value === 'string' && !isEmptyString(value) && value !== 'unknown'

/** Capture-time, exception-only context, separate from the static customAppProperties. */
export const getExceptionContext = (): PostHogEventProperties => {
  const properties: PostHogEventProperties = {}
  const appState = trySafe(() => AppState.currentState)
  if (appState === 'active' || appState === 'background' || appState === 'inactive') {
    properties.$app_state = appState
  }

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return properties
  }

  if (!(typeof __DEV__ !== 'undefined' && __DEV__) && trySafe(() => OptionalExpoUpdates?.isEnabled) === true) {
    const updateId = trySafe(() => OptionalExpoUpdates?.updateId)
    const runtimeVersion = trySafe(() => OptionalExpoUpdates?.runtimeVersion)
    const channel = trySafe(() => OptionalExpoUpdates?.channel)
    const isEmbeddedLaunch = trySafe(() => OptionalExpoUpdates?.isEmbeddedLaunch)
    if (knownString(updateId)) properties.$expo_update_id = updateId
    if (knownString(runtimeVersion)) properties.$expo_runtime_version = runtimeVersion
    if (knownString(channel)) properties.$expo_channel = channel
    if (typeof isEmbeddedLaunch === 'boolean') properties.$expo_is_embedded_launch = isEmbeddedLaunch
  }

  return properties
}
