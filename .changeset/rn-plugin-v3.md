---
'@posthog/react-native-plugin': major
---

Release `@posthog/react-native-plugin` 3.0. See the [migration guide](https://github.com/PostHog/posthog-js/blob/main/packages/react-native-plugin/MIGRATION.md) for upgrade steps

- **Breaking:** require React Native 0.75 or later
- **Breaking:** require iOS 15 or later and macOS 11 or later
- **Breaking:** require posthog-ios 4.0, which needs Xcode 26
- **Breaking:** require posthog-android 4.0
- **Breaking:** resolve posthog-ios through Swift Package Manager instead of CocoaPods trunk and ignore the `posthog.useSpm` Podfile property
- **Breaking:** fail `pod install` for Podfiles that also include `posthog-react-native-session-replay` or the `PostHog` pod — remove them
- **Breaking:** fail `pod install` for Podfiles that use `generate_multiple_pod_projects`, `deduplicate_targets => false`, or plugin targets with different platforms or `use_frameworks!` linkage
- **Breaking:** remove the legacy `start()` method — call `setup()` instead
- **Breaking:** ignore `iOSdebouncerDelayMs` and `androidDebouncerDelayMs` when calling `setup()` directly — pass `throttleDelayMs` instead
- **Breaking:** ignore the experimental iOS session replay option `screenshotModeBackgroundCapture`
- **Breaking:** send native iOS and Android events (crash reports, fatal JavaScript errors, push notification opens) to capture v1 (`/i/v1/analytics/events`) with `Authorization: Bearer <projectToken>`, replacing any `Authorization` from `requestHeaders` — serve this path on reverse proxies and self-hosted instances
- **Breaking:** drop native events when a proxy redirects them, other than with a 307 or 308 to the same origin as `host`
- **Breaking:** report `$locale` on native events as a full language tag with region, such as `de-CH` instead of `de`
- Always record session replay as masked screenshots on iOS and Android, the mode the plugin already used
- Accept `projectToken` as well as `apiKey` in `setup()` options on Android
- Pause iOS native uploads (session replay, native crash reports) while cellular data is turned off for the app, instead of sending requests that fail
- Stop bundling posthog-ios's native surveys in apps that use React Native's Swift Package Manager integration
