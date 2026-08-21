---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Add a `traces.beforeSpanSend` hook that runs on every finished span before it is queued, so you can scrub sensitive attributes or drop spans entirely — return `null` to drop one, or pass an array of hooks to run left to right. The hook sees plain values rather than the OTLP wire encoding, span identity fields are read-only so edits cannot orphan child spans, and a hook that throws drops the span rather than exporting an unscrubbed one.
