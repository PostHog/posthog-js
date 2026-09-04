---
'posthog-node': patch
'posthog-react-native': patch
'@posthog/core': patch
---

Stop uploading logs, metrics and traces batches over 10 MiB, or too large to serialize at all — the batch is split, and a single oversized record dropped, without spending a request on each attempt.
