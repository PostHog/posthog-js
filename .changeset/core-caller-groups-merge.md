---
'@posthog/core': minor
---

`PostHogCoreBase` merges a caller `$groups` over the registered groups on that event, the caller's key winning per group type, and `capture()` no longer registers it; `PostHogCore` keeps its behavior
