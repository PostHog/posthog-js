---
'posthog-js': patch
---

Preserve usable stacks from cross-realm and error-like values captured by `onerror` and `unhandledrejection`, falling back to the positional `onerror` location when available.
