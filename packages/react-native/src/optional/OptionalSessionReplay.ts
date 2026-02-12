import { Platform } from 'react-native'

import type PostHogReactNativeSessionReplay from 'posthog-react-native-session-replay'

/**
 * Extended type for the session replay plugin.
 *
 * Methods marked as optional may not exist in older plugin versions.
 * The SDK checks for their availability at runtime before calling them.
 */
export type PostHogReactNativeSessionReplayExtended = typeof PostHogReactNativeSessionReplay & {
  startRecording?: (resumeCurrent: boolean) => Promise<void>
  stopRecording?: () => Promise<void>
}

export let OptionalReactNativeSessionReplay: PostHogReactNativeSessionReplayExtended | undefined = undefined

try {
  OptionalReactNativeSessionReplay = Platform.select({
    macos: undefined,
    web: undefined,
    default: require('posthog-react-native-session-replay'), // Only Android and iOS
  })
} catch (e) {}
