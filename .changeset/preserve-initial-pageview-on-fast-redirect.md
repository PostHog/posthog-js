---
'posthog-js': patch
---

Prefer synchronous compression for events captured with `send_instantly`, including the initial `$pageview`, to avoid delaying request dispatch on asynchronous compression.
