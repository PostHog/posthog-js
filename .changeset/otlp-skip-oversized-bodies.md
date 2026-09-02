---
'posthog-node': patch
'posthog-react-native': patch
'@posthog/core': patch
---

Stop uploading logs, metrics and traces batches larger than the ingestion endpoint's 2 MB body limit. Such a batch can only come back `413`, so it is split — and, when a single record is itself oversized, dropped — without spending a request on each attempt. The size is measured before compression, matching how the endpoint applies its limit.
