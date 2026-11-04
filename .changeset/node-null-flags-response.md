---
'posthog-node': patch
---

Treat a `/flags` response whose `flags` field is not an object as a failed request instead of throwing a `TypeError`.
