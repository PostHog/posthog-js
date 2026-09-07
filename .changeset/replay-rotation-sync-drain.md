---
'posthog-js': patch
---

fix(replay): drain the compression queue synchronously on a session-id rotation so the old session's unflushed tail ships under the old session id instead of being discarded
