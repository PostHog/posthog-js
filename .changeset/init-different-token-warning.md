---
'posthog-js': patch
---

Prevent duplicate snippet loaders from replacing an initialized instance or replaying queued calls more than once, and warn with actionable guidance when `init()` is called again with a different project token
