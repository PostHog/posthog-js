---
'posthog-js': patch
---

fix(replay): surface why a trigger-gated session is stuck buffering. Warn when a URL trigger regex is anchored so tightly it can only match one exact URL (e.g. `^https://app.example.com/$`), name the pending trigger condition in the buffering diagnostic (e.g. "buffering: URL condition not matched"), and treat a persisted recording config with no `cache_timestamp` as stale so it is revalidated rather than trusted indefinitely.
