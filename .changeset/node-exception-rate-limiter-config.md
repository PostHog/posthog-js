---
'posthog-node': minor
---

Expose the error tracking rate-limiter config via the new `__exceptionRateLimiterRefillRate` and `__exceptionRateLimiterBucketSize` options, matching the browser SDK. Burst protection is scoped per exception type (each distinct `$exception` type gets its own token bucket, with no aggregate cap across types), so these let customers with high-cardinality exception types tune the per-type allowance.
