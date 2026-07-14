---
'posthog-js': minor
'@posthog/core': minor
'@posthog/types': minor
---

Normalize the error tracking rate-limiter config to first-class options. The browser SDK now reads `exceptionRateLimiterRefillRate` / `exceptionRateLimiterBucketSize` on `error_tracking`, with the previous double-underscore `__exceptionRateLimiterRefillRate` / `__exceptionRateLimiterBucketSize` options deprecated but still honoured as a fallback. The option shape (`ExceptionRateLimiterConfig`) and default-resolution logic (`resolveExceptionRateLimiterConfig`) now live in `@posthog/core` and are shared between the browser and Node SDKs.
