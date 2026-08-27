---
'posthog-node': patch
---

Honor `evaluationContexts` during local evaluation — flags whose evaluation contexts don't overlap the configured list are no longer evaluated locally and resolve to `undefined`.
