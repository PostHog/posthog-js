---
'@posthog/core': patch
'posthog-js': patch
---

Avoid using `Blob.stream()` for native async gzip compression to prevent Safari `NotReadableError` stream failures.
