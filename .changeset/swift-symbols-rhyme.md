---
'posthog-node': minor
---

Include group context in the $feature_flag_called deduplication key in \_captureFlagCalledEventIfNeeded, so events fire independently per group combination.
