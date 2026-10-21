---
'posthog-react-native': patch
---

Restart a recording started with `startSessionRecording()` on `optIn()`, in a new session, if `optOut()` stopped it, even when `enableSessionReplay` is off or a linked flag or event trigger would block replay. To keep it stopped, call `stopSessionRecording()` before `optOut()` or after `optIn()`
