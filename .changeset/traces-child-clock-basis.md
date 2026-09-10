---
'posthog-node': patch
'@posthog/core': patch
---

Child spans now share their parent's clock, so a child no longer appears to start before or end after its parent by up to a millisecond, or by more when the system clock is adjusted mid-trace.
