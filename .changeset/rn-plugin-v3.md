---
'@posthog/react-native-plugin': major
---

Release `@posthog/react-native-plugin` 3.0. See the [migration guide](https://github.com/PostHog/posthog-js/blob/main/packages/react-native-plugin/MIGRATION.md) for upgrade steps

- **Breaking:** require React Native 0.75 or later
- **Breaking:** require iOS 15 or later and macOS 11 or later
- **Breaking:** require posthog-ios 4.0, which needs Xcode 26
- **Breaking:** require posthog-android 4.0
- Fail the Android build instead of crashing at runtime when another dependency would raise `posthog-android` past 4.x
- **Breaking:** resolve posthog-ios through Swift Package Manager instead of CocoaPods trunk and ignore the `posthog.useSpm` Podfile property
- **Breaking:** fail `pod install` for Podfiles that also include `posthog-react-native-session-replay` or the `PostHog` pod — remove them
- **Breaking:** fail `pod install` for Podfiles that use `generate_multiple_pod_projects`, `deduplicate_targets => false`, or plugin targets with different platforms or `use_frameworks!` linkage
- **Breaking:** remove the legacy `start()` method — call `setup()` instead
- **Breaking:** ignore `iOSdebouncerDelayMs` and `androidDebouncerDelayMs` when calling `setup()` directly — pass `throttleDelayMs` instead
- **Breaking:** send native iOS and Android events (crash reports, fatal JavaScript errors, iOS rage clicks, push notification opens) to capture v1 (`/i/v1/analytics/events`) with `Authorization: Bearer <projectToken>`, replacing any `Authorization` from `requestHeaders` — serve this path on reverse proxies and self-hosted instances
- **Breaking:** drop native events when a proxy redirects them, other than with a 307 or 308 to the same origin as `host`
- **Breaking:** drop native events whose distinct ID is empty, whitespace-only or over 200 bytes, instead of shortening the ID
- **Breaking:** omit `null` property values from native iOS events and keep `null` list elements in native Android events
- **Breaking:** report `$locale` on native events as the device's preferred language, as a full language tag with region, such as `de-CH` instead of `de`, and as `he`, `id` and `yi` instead of the legacy `iw`, `in` and `ji` on Android. On iOS, an English-only app on a French device sends `fr-FR` instead of `en`
- Always record session replay as masked screenshots on iOS and Android, the mode the plugin already used
- Accept `projectToken` as well as `apiKey` in `setup()` options on Android
- Pause iOS native uploads (session replay, native crash reports) while the device is on cellular and cellular data is turned off for the app, instead of sending requests that fail
- Wait at most 30 seconds on `Retry-After` for session replay and native uploads, and double the wait after each failed upload up to 30 seconds
- Drop native crashes recorded while the user was opted out instead of sending them after `optIn()`
- Mask content a masked view draws outside its bounds on iOS, and stop recording touches inside `ph-no-capture` views on iOS and Android
- Stop bundling posthog-ios's native surveys in apps that use React Native's Swift Package Manager integration
