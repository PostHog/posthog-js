---
'@posthog/core': patch
'posthog-node': minor
---

Honor `filters.holdout` during local feature flag evaluation. A user in an experiment holdout now receives the `holdout-<id>` variant instead of being bucketed into a regular variant, matching how the server evaluates the same flag. The holdout is resolved before the release conditions, so a held-out user never reaches the flag's targeting — including when those conditions would have excluded them, so `isFeatureEnabled` can return true where it previously returned false. Experiments with an active holdout will see variant assignment change for the held-out share of traffic on upgrade, bringing locally evaluated assignments in line with server-evaluated ones.
