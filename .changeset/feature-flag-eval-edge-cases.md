---
'posthog-node': patch
---

Fix three edge cases in local feature flag evaluation. `gt`/`gte`/`lt`/`lte` now compare numerically when both sides parse as finite numbers — previously a string override like `"10"` against numeric value `9` slipped into lexicographic comparison and returned false, and `parseFloat`'s NaN return value leaked through the old `!= null` guard. `is_not_set` now resolves locally — true when the property key is absent, false when present — instead of always throwing `InconclusiveMatchError` and forcing the flag to return undefined. Flag-level condition properties with `negation: true` are now correctly inverted, matching the existing cohort-path behavior in `matchPropertyGroup`.
