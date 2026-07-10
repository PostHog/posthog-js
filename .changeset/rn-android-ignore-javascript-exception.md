---
'@posthog/react-native-plugin': patch
---

fix(react-native): drop native duplicates of fatal JS errors on Android via class matching

The Android plugin suppressed React Native's natively rethrown fatal JS errors (`JavascriptException`) with a `beforeSend` hook matching serialized class-name strings, which R8/ProGuard renaming can defeat in release builds. It now registers the class in posthog-android's `errorTrackingConfig.ignoredExceptionTypes` (added in posthog-android 6.24.0), which matches by `Class.isInstance` across the cause chain and is unaffected by minification.
