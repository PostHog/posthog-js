---
'posthog-node': patch
---

Honor `evaluationContexts` during local evaluation. The poller now keeps only flags whose evaluation contexts are empty or share at least one entry with the configured list, matching the remote `/flags` behavior.
