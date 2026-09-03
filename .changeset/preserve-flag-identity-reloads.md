---
'posthog-js': patch
---

Preserve the anonymous distinct ID used for feature flag persistence when `identify()` queues a reload behind an in-flight flags request.
