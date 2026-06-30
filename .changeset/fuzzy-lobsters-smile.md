---
'@posthog/core': patch
'posthog-node': patch
---

Safely serialize event batches with circular property references instead of crashing during flush.
