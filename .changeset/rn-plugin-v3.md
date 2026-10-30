---
'@posthog/react-native-plugin': major
'posthog-react-native': patch
---

Release `@posthog/react-native-plugin` 3.0, with the upgrade steps in the [migration guide](https://github.com/PostHog/posthog-js/blob/main/packages/react-native-plugin/MIGRATION.md); `posthog-react-native` needs only the last entry

- **Breaking:** require React Native 0.75 or later
- **Breaking:** require iOS 15 or later and macOS 11 or later
- **Breaking:** resolve posthog-ios through Swift Package Manager instead of CocoaPods trunk and ignore the `posthog.useSpm` Podfile property
- **Breaking:** fail `pod install` for Podfiles that use `generate_multiple_pod_projects`, `deduplicate_targets => false`, or plugin targets with different platforms or `use_frameworks!` linkage
- **Breaking:** remove the legacy `start()` method — call `setup()` instead
- **Breaking:** ignore `iOSdebouncerDelayMs` and `androidDebouncerDelayMs` when calling `setup()` directly — pass `throttleDelayMs` instead
- **Breaking:** ignore the experimental iOS session replay option `screenshotModeBackgroundCapture`
- Accept `projectToken` as well as `apiKey` in `setup()` options on Android
- Treat the plugin's `start()` method as optional in `posthog-react-native`
