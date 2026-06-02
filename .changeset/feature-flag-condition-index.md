---
'posthog-js': minor
---

Add `$feature_flag_condition_index` to the `$feature_flag_called` event, capturing the index of the condition set that matched during flag evaluation. This makes it easier to debug why a flag evaluated to a particular value (the flag version is already reported via `$feature_flag_version`).
