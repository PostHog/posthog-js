---
'@posthog/core': minor
---

- Accept `sendFeatureFlagEvent` as the per-call option of `getFeatureFlag()`, `getFeatureFlagResult()` and `isFeatureEnabled()`; it takes precedence over `sendEvent`
- Add `PostHogCoreBase`, the client core without `getFeatureFlagPayload()`, `getFeatureFlagPayloads()`, `getFeatureFlags()`, `getFeatureFlagsAndPayloads()`, `onFeatureFlag()`, `overrideFeatureFlag()` and `onFeatureFlags()`, so an SDK can define its own `onFeatureFlags()` callback; `PostHogCore` keeps them unchanged
