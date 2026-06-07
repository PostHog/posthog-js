---
"posthog-js": patch
---

Re-assert the `token` property if a `before_send` hook removes it, so events are no longer silently rejected by ingest with a 401.
