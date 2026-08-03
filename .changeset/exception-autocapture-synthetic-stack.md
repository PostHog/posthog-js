---
'@posthog/core': patch
'posthog-js': patch
---

Preserve usable stacks from cross-realm errors captured by `onerror` and `unhandledrejection`, and salvage stackless `ErrorEvent` messages with exactly their genuine positional frame.
