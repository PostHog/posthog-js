import type { PostHogEventProperties } from '@posthog/core'
import { AppState, Platform } from 'react-native'
import { OptionalExpoUpdates } from '../optional/OptionalExpoUpdates'
import { OptionalReactNativeDeviceInfo } from '../optional/OptionalReactNativeDeviceInfo'

// Optional native modules can throw even on property access (e.g. an unlinked proxy).
const read = <T>(getter: () => T): T | undefined => {
  try {
    return getter()
  } catch {
    return undefined
  }
}

const knownString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value !== 'unknown'

/** Capture-time, exception-only context, separate from the static customAppProperties. */
export const getExceptionContext = (): PostHogEventProperties => {
  const properties: PostHogEventProperties = {}
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return properties
  }

  const appState = read(() => AppState.currentState)
  if (appState === 'active' || appState === 'background' || appState === 'inactive') {
    properties.$app_state = appState
  }

  if (!(typeof __DEV__ !== 'undefined' && __DEV__) && read(() => OptionalExpoUpdates?.isEnabled) === true) {
    const updateId = read(() => OptionalExpoUpdates?.updateId)
    const runtimeVersion = read(() => OptionalExpoUpdates?.runtimeVersion)
    const channel = read(() => OptionalExpoUpdates?.channel)
    const isEmbeddedLaunch = read(() => OptionalExpoUpdates?.isEmbeddedLaunch)
    if (knownString(updateId)) properties.$expo_update_id = updateId
    if (knownString(runtimeVersion)) properties.$expo_runtime_version = runtimeVersion
    if (knownString(channel)) properties.$expo_channel = channel
    if (typeof isEmbeddedLaunch === 'boolean') properties.$expo_is_embedded_launch = isEmbeddedLaunch
  }

  // One synchronous snapshot per exception; no monitoring, polling or async work on the error path.
  const powerState = read(() => OptionalReactNativeDeviceInfo?.getPowerStateSync?.())
  const batteryLevel = read(() => powerState?.batteryLevel)
  const batteryState = read(() => powerState?.batteryState)
  const lowPowerMode = read(() => powerState?.lowPowerMode)
  if (typeof batteryLevel === 'number' && Number.isFinite(batteryLevel) && batteryLevel >= 0 && batteryLevel <= 1) {
    properties.$battery_level = batteryLevel
  }
  if (batteryState === 'charging' || batteryState === 'full' || batteryState === 'unplugged') {
    properties.$battery_charging = batteryState !== 'unplugged'
  }
  if (typeof lowPowerMode === 'boolean') properties.$low_power_mode = lowPowerMode

  return properties
}
