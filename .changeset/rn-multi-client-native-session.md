---
'posthog-react-native': patch
---

Keep session replay on one session when an app creates more than one `PostHog` client. Only one client now sets up the native SDK and rotates its session: the first client to set it up, or a newer client for the same project, such as one from a remounted `PostHogProvider`. Other clients no longer move session replay onto their own session ids at startup or when the app returns from the background.

A client for a different project no longer changes the native SDK, which stays with the first client's project. On that client, `identify()`, `reset()` and `optOut()`/`optIn()` stay in JS, push notification calls are skipped, `stopSessionRecording()` leaves the other project's recording running, `isSessionReplayActive()` returns `false`, and fatal JavaScript exceptions are captured in JS for its own project.
