---
'@posthog/core': minor
'posthog-node': minor
---

Add `personPropertyKeysKnownAbsent` and `groupPropertyKeysKnownAbsent` flag evaluation options, so local evaluation can resolve `is_not_set` and negated filters without a `/flags` request.
