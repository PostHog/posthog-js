---
'posthog-node': minor
'@posthog/core': minor
---

feat: report flags local evaluation could not resolve on `evaluateFlags()` snapshots via `unresolvedFlags`, tag reads of them with `local_evaluation_inconclusive`, and warn once about flags whose definition local evaluation does not support
