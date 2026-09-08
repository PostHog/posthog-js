---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Add experimental distributed tracing to `posthog-node`: `startSpan`, `withSpan` and `getActiveSpan` record spans against a new `traces` client option. A service with tracing off still forwards an inbound `traceparent`, including from spans nested inside the one that received it, so a distributed trace is not severed. A `traceparent` may be passed as the one-element array `req.headersDistinct` gives.
