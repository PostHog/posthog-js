---
'posthog-react-native': patch
---

Restart a recording started with `startSessionRecording()` on `optIn()`, in a new session, if `optOut()` stopped it, even when `enableSessionReplay` is off or a linked flag would block replay. With event triggers configured, it waits for a trigger to fire in the new session. To keep it stopped, call `stopSessionRecording()` before `optOut()` or after `optIn()`
