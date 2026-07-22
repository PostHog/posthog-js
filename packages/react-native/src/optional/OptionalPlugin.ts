import { Platform } from 'react-native'

// Optional native dependency; resolved at runtime via require()/try-catch below.
import type PostHogReactNativePlugin from '@posthog/react-native-plugin'

/**
 * `@posthog/react-native-plugin` is the primary native plugin; we fall back to
 * `posthog-react-native-session-replay` (same surface minus the newer methods)
 * when only the legacy package is installed. Optional methods are absent on
 * older plugins, so callers check availability at runtime.
 */
export type PostHogReactNativePluginExtended = typeof PostHogReactNativePlugin & {
  setup?: (sessionId: string, sdkOptions: { [key: string]: any }, pluginConfig: { [key: string]: any }) => Promise<void>
  startRecording?: (resumeCurrent: boolean) => Promise<void>
  stopRecording?: () => Promise<void>
  addExceptionStep?: (message: string, properties?: { [key: string]: any }) => Promise<void>
}

export let OptionalReactNativePlugin: PostHogReactNativePluginExtended | undefined = undefined

if (Platform.OS !== 'web') {
  try {
    OptionalReactNativePlugin = require('@posthog/react-native-plugin')
  } catch (e) {}

  // The legacy fallback is session-replay only and has no macOS support, so it's skipped on macOS.
  if (!OptionalReactNativePlugin && Platform.OS !== 'macos') {
    try {
      OptionalReactNativePlugin = require('posthog-react-native-session-replay')
    } catch (e) {}
  }
}
