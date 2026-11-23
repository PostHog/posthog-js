---
'@posthog/core': minor
---

- Accept `sendFeatureFlagEvent` as the per-call option of `getFeatureFlag()`, `getFeatureFlagResult()` and `isFeatureEnabled()`; it takes precedence over `sendEvent`
- Add `PostHogCoreBase`, the client core without `getFeatureFlagPayload()`, `getFeatureFlagPayloads()`, `getFeatureFlags()`, `getFeatureFlagsAndPayloads()`, `onFeatureFlag()`, `overrideFeatureFlag()`, `onFeatureFlags()` and `reloadFeatureFlagsAsync()`, so an SDK can define its own. On `PostHogCoreBase`, a flag whose variant is an empty string reads as disabled, `$active_feature_flags` lists only enabled flags, and bootstrapped string payloads stay strings. `PostHogCore` keeps all of these unchanged
- `PostHogCoreBase` lets a registered or caller `$is_identified` or `$process_person_profile` win (a `null` one counts as unset), leaves a registered `$process_person_profile` off identity and person-update events (`$identify`, `$create_alias`, `$groupidentify`, `$set`, `$set_once`, `$merge_dangerously`) and stamps person state on `$autocapture` events; `PostHogCore` keeps its behavior
- Add `withoutNullMembers()`, which removes `null` and `undefined` object members recursively without changing array positions
- Add `isEnabledFlagValue()`, which tells whether a flag value is on
- Deprecate the per-call `sendEvent` option in favor of `sendFeatureFlagEvent`
- Fix feature flags loaded for the previous user being stored and emitted when `reset()` runs during a flag request
