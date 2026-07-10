---
'@posthog/react-native-plugin': minor
---

Add macOS support so the plugin builds on react-native-macos targets. The podspec now declares an `osx` platform, and all iOS-only posthog-ios APIs (session replay config, surveys, session-recording controls) are guarded with `#if os(iOS)`. Session replay remains iOS-only; macOS gets native error tracking.
