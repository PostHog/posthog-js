---
'posthog-react-native': patch
---

Restart a recording started with `startSessionRecording()` on `optIn()`, in a new session, if `optOut()` stopped it, even when `enableSessionReplay` is off
