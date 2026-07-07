---
'posthog-js': patch
---

fix session recordings missing their initial full snapshot after an idle session-id rotation

When the session id rotated while the recorder was idle, the restarted recorder's Meta and FullSnapshot were appended to the previous session's buffer and shipped under the old session id, leaving the new recording unplayable until the next periodic snapshot. The buffer now rebinds on any session-id change regardless of idle state, and as a safety net the recorder requests a full snapshot whenever an incremental is about to ship for a session that has not produced one.
