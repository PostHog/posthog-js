---
'posthog-js': patch
---

Fix events captured right after `identify()` racing the `$identify` request, and so missing its person properties, while a Meta `$fbc` or `$fbp` was pending.
