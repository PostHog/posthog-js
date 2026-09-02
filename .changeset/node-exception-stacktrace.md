---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Record `exception.stacktrace` on spans: `recordException` and a throwing `withSpan` callback now attach the stack alongside `exception.type` and `exception.message`. Stacks are attached by default and carry your server's file paths; remove the attribute in `traces.beforeSpanSend` if you'd rather they didn't leave the process. The value is bounded by `traces.maxAttributeValueLength` like any other attribute.
