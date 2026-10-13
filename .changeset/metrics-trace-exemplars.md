---
'@posthog/core': minor
'@posthog/types': minor
'posthog-node': minor
---

`posthog.metrics` now attaches a trace exemplar to each series it flushes. A sample recorded inside a sampled span (for example inside `posthog.withSpan` in posthog-node) stamps its data point with that span's trace ID, span ID, and value, so metric charts can link to a representative trace. One exemplar per series per flush window; the last sample wins.
