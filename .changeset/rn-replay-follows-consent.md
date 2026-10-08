---
'posthog-react-native': patch
---

Session replay now follows consent: `optOut()` stops any active recording, including one started with `startSessionRecording()`. Once the promise from `optIn()` resolves, automatic replay has resumed under a new session ID when `enableSessionReplay` and your project's replay settings allow it. Event triggers must fire again in the new session, and a recording stopped with `stopSessionRecording()` stays stopped. To resume a manual recording, call `startSessionRecording()` again after `optIn()`.
