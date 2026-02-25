---
'posthog-node': minor
---

feat: getFeatureFlagResult, getAllFlags, getAllFlagsAndPayloads now have context-sensitive overrides which do not require `distinctId` as a parameter, instead reading it from the current context.
