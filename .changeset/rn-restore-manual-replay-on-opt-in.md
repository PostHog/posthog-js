---
'posthog-react-native': patch
---

Restart a recording started with `startSessionRecording()` on `optIn()`, in a new session, if `optOut()` stopped it. It restarts even when `enableSessionReplay` is off, but still needs the linked flag to be active and waits for a configured event trigger to fire in the new session. To keep it stopped, call `stopSessionRecording()` before `optOut()` or after `optIn()`
