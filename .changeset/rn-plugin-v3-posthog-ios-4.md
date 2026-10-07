---
'@posthog/react-native-plugin': major
---

**Breaking:** require posthog-ios 4.0, which needs Xcode 26. With React Native's SwiftPM integration, the plugin no longer pulls in posthog-ios's native surveys, which it doesn't use
