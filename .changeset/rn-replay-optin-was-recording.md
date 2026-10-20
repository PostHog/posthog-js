---
'posthog-react-native': patch
---

Restart session replay on `optIn()` only if it was recording at `optOut()`, matching posthog-ios and posthog-android
