---
'@posthog/types': minor
'@posthog/core': minor
'posthog-js': minor
'posthog-node': minor
---

Add first-class configuration for exception burst protection. The browser SDK accepts `error_tracking.burstProtection: { bucketSize, refillRate }` (the `__exceptionRateLimiterRefillRate` and `__exceptionRateLimiterBucketSize` options are deprecated but still honoured), and the Node SDK gains the equivalent `exceptionBurstProtection` option, which was previously hardcoded. Burst protection is scoped per exception type — each distinct `$exception` type gets its own token bucket with no aggregate cap across types — and applies only to autocaptured exceptions; manual `captureException` calls are never rate limited. The shared semantics live in `ExceptionBurstProtectionOptions` in `@posthog/types`, and the limiter construction is shared via `createExceptionRateLimiter` in `@posthog/core`.
