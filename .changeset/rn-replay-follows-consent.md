---
'posthog-react-native': patch
---

Session replay now follows consent: `optOut()` stops an active recording (whether replay started it or the app started it with `startSessionRecording()`), and `optIn()` starts replay again under a new session.
