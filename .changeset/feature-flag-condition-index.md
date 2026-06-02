---
'posthog-js': minor
---

Add `$feature_flag_condition_index` to the `$feature_flag_called` event, capturing the index of the condition set that matched during flag evaluation. This makes it easier to debug why a flag evaluated to a particular value (the flag version is already reported via `$feature_flag_version`).

Also fixes a feature-flag persistence inconsistency: a flat / bootstrapped flag update (e.g. `bootstrap.featureFlags`, which loads flags without the v2 `flags` detail object) wiped the persisted per-flag details but left a previously-stored `$feature_flag_request_id` / `$feature_flag_evaluated_at` behind. This made `$feature_flag_called` events look like a fresh server evaluation (request id + evaluated-at present) while silently missing `$feature_flag_version` / `_reason` / `_id` / `_condition_index`. On a full replace these values are now kept consistent with the flag details they describe (cleared when the response doesn't carry them); partial reloads (`flag_keys`) and error upserts still preserve the prior values.
