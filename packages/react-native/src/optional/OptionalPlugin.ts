import { Platform } from 'react-native'

// `@posthog/react-native-plugin` is an optional native dependency. The type import
// resolves against the workspace package; runtime resolution is tolerant via
// require()/try-catch (see below) so the SDK still works when it isn't installed.
import type PostHogReactNativePlugin from '@posthog/react-native-plugin'

/**
 * Extended type for the native plugin module.
 *
 * `@posthog/react-native-plugin` is the primary native plugin; we fall back to
 * `posthog-react-native-session-replay` (which has the same surface minus the
 * newer methods) when only the legacy package is installed.
 *
 * Methods marked as optional may not exist in older plugin versions.
 * The SDK checks for their availability at runtime before calling them.
 */
export type PostHogReactNativePluginExtended = typeof PostHogReactNativePlugin & {
  setup?: (
    sessionId: string,
    sdkOptions: { [key: string]: any },
    pluginConfig: { [key: string]: any }
  ) => Promise<void>
  startRecording?: (resumeCurrent: boolean) => Promise<void>
  stopRecording?: () => Promise<void>
}

export let OptionalReactNativePlugin: PostHogReactNativePluginExtended | undefined = undefined

if (Platform.OS !== 'macos' && Platform.OS !== 'web') {
  try {
    OptionalReactNativePlugin = require('@posthog/react-native-plugin')
  } catch (e) {}

  if (!OptionalReactNativePlugin) {
    try {
      OptionalReactNativePlugin = require('posthog-react-native-session-replay')
    } catch (e) {}
  }
}
