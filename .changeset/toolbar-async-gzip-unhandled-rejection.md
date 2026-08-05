---
'posthog-js': patch
---

Fix a benign network failure (e.g. `TypeError: Failed to fetch`) in the async native-gzip request path surfacing as an unhandled promise rejection, which exception autocapture would otherwise pick up
