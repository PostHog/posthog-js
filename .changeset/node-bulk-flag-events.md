---
'posthog-node': minor
---

Add `getFeatureFlags(keys, distinctId, options)` for evaluating a known subset of feature flags in one bulk pass while still emitting `$feature_flag_called` events per resolved flag. Also adds a `sendFeatureFlagEvents` option to the existing `getAllFlags` and `getAllFlagsAndPayloads` methods for opt-in per-flag event emission. Locally-evaluated flags reuse the poller's cached definitions; any keys that can't be resolved locally fall through to a single remote `/flags` call with `flag_keys_to_evaluate`. Event dedup uses the existing `distinctIdHasSentFlagCalls` cache so the single-flag and bulk paths share one source of truth.
