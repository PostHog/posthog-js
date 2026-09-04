---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Add a `traces.beforeSpanSend` hook to edit a finished span before it is queued, or drop it by returning `null` — a hook that throws, or returns anything that is not a span record, also drops the span.
