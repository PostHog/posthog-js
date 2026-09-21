---
'posthog-js': patch
---

Fix `$session_id` being sent as `null` when a sibling tab resets the session before this tab captures its first event (#5036)
