---
'posthog-node': patch
---

getFeatureFlag() respects exponential backoff for HTTP 401, 403, and 429 responses.
