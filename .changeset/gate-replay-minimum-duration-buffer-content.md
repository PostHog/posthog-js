---
'posthog-js': patch
---

Fix session replay shipping empty, unplayable recordings when a minimum duration is configured. A buffer holding only lifecycle events (e.g. a lone `$session_starting` on session rotation) is no longer flushed once the session id ages past the minimum duration.
