---
'posthog-js': patch
'@posthog/core': patch
---

Use async native CompressionStream for gzip compression to avoid blocking the main thread
