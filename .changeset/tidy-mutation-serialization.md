---
'posthog-js': patch
---

Reduce per-node allocations when serializing session replay mutations by reusing serialization options within each emission.
