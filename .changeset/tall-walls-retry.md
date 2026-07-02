---
'@posthog/core': patch
'posthog-js': patch
'posthog-node': patch
---

Retry `/flags` requests that receive HTTP 502 or 504 responses.
