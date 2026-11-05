---
'@posthog/react-native-plugin': major
'posthog-react-native': patch
---

Release `@posthog/react-native-plugin` 3.0, with the upgrade steps in the [migration guide](https://github.com/PostHog/posthog-js/blob/main/packages/react-native-plugin/MIGRATION.md); `posthog-react-native` needs only the last two entries

- **Breaking:** require React Native 0.75 or later
- **Breaking:** require iOS 15 or later and macOS 11 or later
- **Breaking:** require posthog-ios 4.0, which needs Xcode 26
- **Breaking:** resolve posthog-ios through Swift Package Manager instead of CocoaPods trunk and ignore the `posthog.useSpm` Podfile property
- **Breaking:** fail `pod install` for Podfiles that use `generate_multiple_pod_projects`, `deduplicate_targets => false`, or plugin targets with different platforms or `use_frameworks!` linkage
- **Breaking:** remove the legacy `start()` method — call `setup()` instead
- **Breaking:** ignore `iOSdebouncerDelayMs` and `androidDebouncerDelayMs` when calling `setup()` directly — pass `throttleDelayMs` instead
- **Breaking:** ignore the experimental iOS session replay option `screenshotModeBackgroundCapture`
- **Breaking:** send iOS native events (crash reports, fatal JS errors, push notification opens) to capture v1 (`/i/v1/analytics/events`) with `Authorization: Bearer <projectToken>`, replacing any `Authorization` from `requestHeaders` — serve this path on reverse proxies and self-hosted instances
- **Breaking:** report `$locale` on iOS native events as the device language with its region, such as `de-CH` instead of `de`, and add `$app_language`
- **Breaking:** require posthog-android 4.0
- Always record Android session replay as masked screenshots, the mode the plugin already used
- Accept `projectToken` as well as `apiKey` in `setup()` options on Android
- Always record iOS session replay as masked screenshots, the mode the plugin already used
- Pause iOS native uploads (session replay, native crash reports) while cellular data is turned off for the app, instead of sending requests that fail
- Stop bundling posthog-ios's native surveys in apps that use React Native's Swift Package Manager integration
- Treat the plugin's `start()` method as optional in `posthog-react-native`
- Deprecate `screenshotModeBackgroundCapture` in `posthog-react-native`
