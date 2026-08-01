---
'posthog-js': patch
---

Clear `register_for_session` properties when the `$session_id` rotates, matching the documented behavior that session super properties are cleared when the session ends.
