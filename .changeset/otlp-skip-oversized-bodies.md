---
'posthog-node': patch
'posthog-react-native': patch
'@posthog/core': patch
---

Stop sending logs and metrics batches over 10 MiB, or too large to serialize at all, instead of spending a request to discover the endpoint refuses them.
