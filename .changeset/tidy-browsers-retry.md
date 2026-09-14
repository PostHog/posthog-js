---
'posthog-js': patch
---

Respect Retry-After, including repeated headers, up to 30 seconds on retryable browser responses without shortening exponential backoff.
