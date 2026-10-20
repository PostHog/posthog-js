---
'posthog-node': minor
'@posthog/core': minor
---

feat: report flags local evaluation could not resolve on `evaluateFlags()` snapshots via `unresolvedFlags`, tag reads of them with `local_evaluation_inconclusive`, and warn once about flags whose definition local evaluation does not support

Behavior changes:

- A condition with a filter local evaluation cannot check and a filter that does not match now resolves locally as no match, instead of falling back to a server request or staying unresolved.
- `$feature_flag_called` events from snapshot reads report `local_evaluation_inconclusive` instead of `flag_missing` for these flags.
- The load-time warning now also logs with `strictLocalEvaluation: true`.
