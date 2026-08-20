---
'posthog-node': minor
---

`flush()` now drains queued tracing spans as well as events, so a serverless handler that calls `flush()` before returning no longer leaves ended spans sitting in the queue until the container is reused. Events and spans are flushed concurrently, and a failed span export leaves the spans queued for the next flush rather than rejecting.
