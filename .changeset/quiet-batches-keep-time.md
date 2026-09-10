---
'posthog-js': patch
---

Preserve batched event timestamps so delayed retries do not shift event times and prevent deduplication.
