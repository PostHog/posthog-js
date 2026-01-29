---
'posthog-js': minor
'@posthog/core': minor
'@posthog/types': minor
---

Filter out flags marked as failed before merging with cached values, preventing transient backend errors from overwriting previously evaluated flag states
