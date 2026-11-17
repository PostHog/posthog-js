---
'posthog-js': patch
---

Send base64 beacon bodies as bare `text/plain` so `/i/v0/e/` accepts page-unload events when gzip compression is disabled or unavailable
