---
'posthog-node': patch
---

Document that `isLocalEvaluationReady()` and `waitForLocalEvaluationReady()` require at least one loaded flag; use the `localEvaluationFlagsLoaded` event to observe empty loads.
