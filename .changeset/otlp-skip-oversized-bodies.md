---
'@posthog/core': patch
---

Stop sending logs, metrics and traces batches larger than the ingestion endpoint's 2 MB body limit.
