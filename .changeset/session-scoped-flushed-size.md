---
'posthog-js': patch
---

fix(replay): scope the session-recording flushed-size tracker to the session

`$sdk_debug_replay_flushed_size` was stored as a single device-global value in persistence and only reset on an in-page session rotation, so it leaked across page loads and tabs and over-counted on returning visitors. The tracker now keys the running total to the current session id, so a new session starts from zero and a fresh load reading an ongoing session sees the correct total.

The internal persistence key backing this counter (`$sess_rec_flush_size`) was also unintentionally attached to every captured event as a super-property; it is now marked hidden so it no longer ships on events. The value remains available on session-replay debug events as `$sdk_debug_replay_flushed_size`.
