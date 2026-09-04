---
'posthog-node': patch
'posthog-react-native': patch
'@posthog/core': patch
---

Honor `Retry-After` when the ingestion endpoint refuses a logs, metrics or traces batch, instead of retrying on the SDK's own backoff alone.
