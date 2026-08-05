---
'@posthog/core': patch
'posthog-node': patch
---

Use Node's zlib gzip implementation for Node SDK payloads to avoid sustained memory growth from frequent Web Streams compression.
