---
'@posthog/convex': patch
---

Fix the refresh cron not registering when `POSTHOG_PERSONAL_API_KEY` is forwarded from the installing app. Convex only forwards component env vars at runtime, so the previous load-time gate saw an empty value during deploy-time module analysis and silently dropped the cron. The cron now registers unconditionally and gates at runtime, and the default polling interval is now 10 minutes (override with `POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS`).

Fixes [#3683](https://github.com/PostHog/posthog-js/issues/3683).
