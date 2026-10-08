import { requireNativeModule } from 'expo-modules-core'

/**
 * Triggers a genuine NATIVE crash on the current platform:
 *  - iOS: `fatalError(...)` (a Swift trap, caught by posthog-ios' PLCrashReporter)
 *  - Android: an uncaught `RuntimeException` on the main looper (caught by
 *    posthog-android's uncaught-exception handler)
 *
 * The JS layer cannot catch this — the app process terminates. PostHog reports
 * the native crash on the next app launch. Requires `@posthog/react-native-plugin`
 * installed and `errorTracking.autocapture.nativeCrashes: true` at init.
 *
 * Resolved lazily so importing this module never throws on platforms without the
 * native module (e.g. web), only when the function is actually called.
 */
export function crashNative(): void {
  requireNativeModule('NativeCrash').crashNative()
}
