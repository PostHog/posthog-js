---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Attach `exception.stacktrace` to the exception events recorded by `recordException` and by a throwing `withSpan` callback — remove it in `traces.beforeSpanSend` to keep your server's file paths out of PostHog.
