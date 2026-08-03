---
'posthog-js': minor
'@posthog/types': minor
---

Add `session_recording.sampling` to disable or throttle mousemove capture (and optionally mouseInteraction) in session replay. Canvas recording now merges its canvas sampling with user-provided sampling instead of overwriting it.
