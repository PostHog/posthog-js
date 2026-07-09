---
"@posthog/core": patch
---

Coalesce concurrent flush requests to avoid chaining redundant flushes while offline.
