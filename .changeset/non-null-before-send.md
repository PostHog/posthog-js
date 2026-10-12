---
'@posthog/types': patch
'@posthog/core': patch
'posthog-js': patch
'posthog-node': patch
---

Fix `before_send` callback types to accept non-null events while still allowing `null` returns to drop events.
