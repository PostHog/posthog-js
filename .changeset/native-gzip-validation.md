---
'posthog-js': patch
'@posthog/core': patch
---

Validate native gzip output before sending requests and fall back when CompressionStream returns malformed data.
