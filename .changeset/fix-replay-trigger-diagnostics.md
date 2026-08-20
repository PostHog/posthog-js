---
'posthog-js': patch
---

fix(replay): surface why a trigger-gated session is stuck buffering. Warn when a URL trigger regex appears unexpectedly narrow (e.g. `^https://app.example.com/$`), name pending V1 and V2 trigger conditions in the buffering diagnostic, and have current SDK cores revalidate persisted recording config with no `cache_timestamp` while keeping the lazy recorder compatible with older cores.
