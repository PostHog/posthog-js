---
'posthog-node': minor
---

Local evaluation requests flag definitions with `v=2` and evaluates flags in the newer configuration format locally; a flag it cannot evaluate falls back to a remote request, or has no value with `onlyEvaluateLocally`.
