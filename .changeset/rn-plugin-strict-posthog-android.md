---
'@posthog/react-native-plugin': patch
---

Fail the Android build instead of crashing at runtime when something else in the app, such as a direct `posthog-android` 4.x dependency, core `posthog` 7.x or `posthog-server` 2.25, would raise `posthog-android` to 4.0. This version only supports `posthog-android` 3.x.
