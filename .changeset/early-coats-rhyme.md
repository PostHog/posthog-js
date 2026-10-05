---
'posthog-js': patch
---

Restore batching for events carrying pending Meta `$fbc` or `$fbp` identifiers to reduce races with preceding `identify()` calls.
