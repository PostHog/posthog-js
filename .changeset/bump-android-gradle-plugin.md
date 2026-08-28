---
'posthog-react-native': patch
---

Fix Android builds failing to resolve a Kotlin compiler plugin when `uploadNativeSymbols` is enabled, by picking up `com.posthog:posthog-android-gradle-plugin` 1.5.2. Re-run `expo prebuild` to apply it.
