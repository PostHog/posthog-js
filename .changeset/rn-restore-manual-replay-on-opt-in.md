---
'posthog-react-native': patch
---

Restart session replay in a new session when `optIn()` or `reset()` clears an opt-out and the app wanted replay on (`enableSessionReplay` or `startSessionRecording()`, with no `stopSessionRecording()` since), including a manual recording made with `enableSessionReplay` off and replay that was waiting for the linked flag, sampling or an event trigger; to keep replay stopped, call `stopSessionRecording()` before `optOut()` or after `optIn()`.
