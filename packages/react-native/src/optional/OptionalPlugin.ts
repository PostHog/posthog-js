import { Platform } from 'react-native'

// Optional native dependency; resolved at runtime via require()/try-catch below.
import type PostHogReactNativePlugin from '@posthog/react-native-plugin'
import type { PostHogPushIdentityProvider } from '../types'

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
  registerPushNotificationToken?: (deviceToken: string, appId: string | null) => Promise<void>
  unregisterPushNotificationToken?: () => Promise<void>
  setOptOut?: (optOut: boolean) => Promise<void>
  capturePushNotificationOpened?: (properties: { [key: string]: any }) => Promise<void>
  setPushIdentityProvider?: (provider: PostHogPushIdentityProvider) => void
  reset?: (distinctId: string, anonymousId: string) => Promise<void>
}

type OptionalModuleLoader = (moduleName: string) => any

export const resolveOptionalPlugin = (
  platformOS: string,
  loadModule: OptionalModuleLoader = require
): { plugin: PostHogReactNativePluginExtended | undefined; version: string | undefined } => {
  let plugin: PostHogReactNativePluginExtended | undefined
  let version: string | undefined

  if (platformOS !== 'web') {
    try {
      plugin = loadModule('@posthog/react-native-plugin')
      try {
        version = loadModule('@posthog/react-native-plugin/package.json')?.version
      } catch {
        // Strict resolvers can reject this unexported subpath on older plugin versions.
        // Metro falls back to file-based resolution, so version logging only degrades to unknown where needed.
      }
    } catch {}

    // The legacy fallback is session-replay only and has no macOS support, so it's skipped on macOS.
    if (!plugin && platformOS !== 'macos') {
      try {
        plugin = loadModule('posthog-react-native-session-replay')
      } catch {}
    }
  }

  return { plugin, version }
}

const optionalPlugin = resolveOptionalPlugin(Platform.OS)

export const OptionalReactNativePlugin = optionalPlugin.plugin

// Resolved version of the loaded native plugin. It is logged next to the replay
// config so a stale plugin, which silently ignores newer options such as sampleRate,
// is visible in a debug log.
export const OptionalReactNativePluginVersion = optionalPlugin.version
