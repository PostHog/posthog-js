---
'@posthog/core': patch
'posthog-js': patch
---

Validate gzip request bodies at the browser send boundary and fall back to JSON if the outgoing body is not gzip data.
