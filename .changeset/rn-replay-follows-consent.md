---
'posthog-react-native': patch
---

Stop session replay on `optOut()` and resume automatic replay under a new session ID on `optIn()`, unless the app stopped it with `stopSessionRecording()`
