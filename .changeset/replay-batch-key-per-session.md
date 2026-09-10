---
'posthog-js': patch
---

Send each replay session's snapshots in their own request so a session rotation no longer files the new session's first snapshot under the old session.
