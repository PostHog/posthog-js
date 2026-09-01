---
'@posthog/core': patch
---

Honor `Retry-After` on the logs, metrics and traces export queues when a batch is refused.
