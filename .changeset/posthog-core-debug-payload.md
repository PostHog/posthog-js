---
'@posthog/core': patch
---

Debug mode logs an emitted event's payload through an overridable `describeDebugPayload`, so an SDK can log a summary instead. The default is unchanged.
