---
'@posthog/core': minor
'@posthog/types': minor
'posthog-node': minor
---

feat(node): expose `traceId` and `spanId` getters on the `Span` handle, for correlating logs from other loggers with a trace without parsing `traceparent()`
