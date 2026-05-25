---
'posthog-node': patch
---

Include group context in the $feature_flag_called deduplication key in \_captureFlagCalledEventIfNeeded, so events fire independently per group combination.
