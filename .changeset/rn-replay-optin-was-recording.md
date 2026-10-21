---
'posthog-react-native': patch
---

Restart session replay on `optIn()` only if it was recording at `optOut()`, matching posthog-ios. A `stopSessionRecording()` call made while opted out no longer keeps replay stopped on `optIn()`; stop it before `optOut()` or after `optIn()` instead
