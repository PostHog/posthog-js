---
'@posthog/convex': patch
---

Fix `POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS` being ignored. The flag-refresh interval was read when the cron was registered, but Convex forwards component env vars only at runtime, so the value was always empty there and the cron was pinned to the 60s default. The refresh now runs as a self-rescheduling loop that reads the interval at runtime, with a supervisor cron that keeps the loop alive, so the configured interval is honoured.

Fixes [#3957](https://github.com/PostHog/posthog-js/issues/3957).
