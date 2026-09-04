---
'@posthog/core': patch
---

Ignore an inbound `traceparent` that W3C requires a vendor to reject — a version `00` header carrying fields beyond `trace-id`, `parent-id` and `trace-flags`, or one whose ids are uppercase hex — and start a fresh trace instead.
