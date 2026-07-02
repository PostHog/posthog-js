---
'@posthog/convex': patch
---

Gate the feature-flag local-evaluation refresh loop so it no longer runs on installs that don't use it. The self-rescheduling loop and its 5-minute supervisor now no-op unless `POSTHOG_PERSONAL_API_KEY` is set — event-only and remote-flag projects no longer incur ~3k/day skipped scheduled executions or the log churn they produced. Adds `POSTHOG_DISABLE_LOCAL_EVALUATION` as an explicit off-switch for projects that set a key but don't want the background poll. Behavior is unchanged when a key is configured.
