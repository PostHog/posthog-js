---
'@posthog/core': minor
---

- Accept `sendFeatureFlagEvent` as the per-call option of `getFeatureFlag()`, `getFeatureFlagResult()` and `isFeatureEnabled()`; it takes precedence over `sendEvent`
- Add `PostHogCoreBase`, the client core without `getFeatureFlagPayload()`, `getFeatureFlagPayloads()`, `getFeatureFlags()`, `getFeatureFlagsAndPayloads()`, `onFeatureFlag()`, `overrideFeatureFlag()`, `onFeatureFlags()` and `reloadFeatureFlagsAsync()`, so an SDK can define its own. On `PostHogCoreBase`, a flag whose variant is an empty string reads as disabled, `$active_feature_flags` lists only enabled flags, and bootstrapped string payloads stay strings. `PostHogCore` keeps all of these unchanged
- Add `isEnabledFlagValue()`, which tells whether a flag value is on
- Deprecate the per-call `sendEvent` option in favor of `sendFeatureFlagEvent`
- Fix feature flags loaded for the previous user being stored and emitted when `reset()` runs during a flag request
