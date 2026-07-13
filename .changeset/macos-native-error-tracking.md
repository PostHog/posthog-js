---
'posthog-react-native': minor
---

Enable native crash autocapture (`errorTracking.autocapture.nativeCrashes`) on macOS. The native plugin now loads on macOS (previously iOS/Android only); the legacy session-replay-only fallback stays iOS/Android. Requires `@posthog/react-native-plugin` >= 2.2.0.
