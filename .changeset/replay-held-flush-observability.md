---
'posthog-js': patch
---

Session replay now reports why a recording holds its buffer. An epoch that starts without user interaction keeps its snapshots and uploads nothing, while `$recording_status` still reads `active`. Captured events now carry `$sdk_debug_replay_flush_hold_reason` (`no_interaction_since_recording_started` or `no_interaction_since_session_rotated`), and the SDK logs the reason once per held epoch in debug mode.
