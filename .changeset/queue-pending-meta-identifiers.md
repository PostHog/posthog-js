---
'posthog-js': patch
---

Batch events that carry a pending `$fbc` or `$fbp` again, so that they no longer reach ingestion before the `$identify` sent just before them.
