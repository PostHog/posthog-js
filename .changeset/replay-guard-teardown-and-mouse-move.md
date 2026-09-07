---
'posthog-js': patch
---

Fix two silent session replay failures. Recorder teardown no longer stops when a cleanup handler throws, so recording restarts after an idle reset and `isRecording()` stops reporting a stopped recorder as started. Playback no longer ends or stalls when a recording holds a malformed mouse-move `positions` value; the player skips that one event and falls back to the event's own timestamp instead of scheduling it at a time the timer can never reach.
