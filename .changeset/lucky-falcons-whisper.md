---
'@posthog/react-native-plugin': patch
---

Drop native captures of fatal React Native JS errors that the JS layer already reports, so a fatal JS error no longer produces two `$exception` events. Works on Android (both architectures) and iOS (old architecture only). On the iOS new architecture, fatal JS exception events surface as a generic `SIGABRT` crash event with no JS-error text in any field, so they currently cannot be filtered
