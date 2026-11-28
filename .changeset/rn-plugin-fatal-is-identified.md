---
'@posthog/react-native-plugin': patch
---

On iOS, send a fatal JavaScript exception without `$is_identified` when the JavaScript event has none, as on Android, instead of with a `null` value
