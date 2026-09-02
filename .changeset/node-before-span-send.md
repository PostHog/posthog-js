---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Add a `traces.beforeSpanSend` hook to scrub attributes on a finished span, or return `null` to drop it.
