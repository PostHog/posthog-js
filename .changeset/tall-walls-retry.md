---
'@posthog/core': patch
---

Retry `/flags` requests that receive HTTP 502 or 504 responses.
