---
'posthog-js': patch
---

Avoid repeatedly traversing the same subtree during session replay mirror cleanup when it moves multiple times in one mutation batch.
