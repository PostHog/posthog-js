---
'posthog-node': patch
'posthog-react-native': patch
'@posthog/core': patch
---

Stop uploading logs, metrics and traces batches larger than the ingestion endpoint's request body limit — such a batch is split, and a single oversized record dropped, without spending a request on each attempt.
