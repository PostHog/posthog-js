---
'posthog-react-native': minor
---

feat: add manual session replay control

New methods for programmatic control of session recording:

- `startSessionRecording(resumeCurrent?: boolean)` - Start or resume session recording. Pass `false` to start a new session.
- `stopSessionRecording()` - Stop the current session recording.
- `isSessionReplayActive()` - Check if session replay is currently active.

**Note:** Requires `posthog-react-native-session-replay` version 1.3.0 or higher. Users with older plugin versions will see a warning when calling these methods.
