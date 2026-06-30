---
'@posthog/core': patch
---

Retry capture and logs requests on transient HTTP errors such as 408, 429, and 5xx while continuing to avoid retries for non-retryable 4xx responses.
