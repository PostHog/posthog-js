---
'posthog-js': minor
---

feat(replay): rotate the recording session when it reaches a size budget

Adds a `session_recording.maxSessionSizeMb` option that rotates a recording to a new, linked session once the session's flushed size reaches the budget. It defaults to `300` when using the `2026-05-30` defaults (off otherwise) and is clamped to the 1–500 MiB range; it is normally only changed after interaction with the PostHog support team.

The previous session is linked to the new one via the existing `$session_ending` / `$session_starting` events, and a `$session_size_rotation` custom event marks the point at which the rotation happened. This bounds any single recording so it stays playable and within ingestion limits, without dropping data or interrupting recording.
