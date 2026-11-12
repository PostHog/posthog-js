---
'@posthog/core': minor
---

- Accept `sendFeatureFlagEvent` as the per-call option of `getFeatureFlag()`, `getFeatureFlagResult()` and `isFeatureEnabled()`; it takes precedence over `sendEvent`
- Move `getFeatureFlagPayload()`, `getFeatureFlagPayloads()`, `getFeatureFlags()`, `getFeatureFlagsAndPayloads()`, `onFeatureFlag()` and `overrideFeatureFlag()` from `PostHogCore` to the new `PostHogCoreWithLegacyFeatureFlags` subclass — extend it to keep them
