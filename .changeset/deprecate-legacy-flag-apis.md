---
'@posthog/core': patch
'posthog-react-native': patch
'posthog-js-lite': patch
---

Deprecate `getFeatureFlags()`, `getFeatureFlagPayloads()` and `getFeatureFlagsAndPayloads()` in favor of `getAllFeatureFlags()`, `onFeatureFlag()` in favor of `onFeatureFlags()`, the `cb` option of `reloadFeatureFlags()` in favor of `reloadFeatureFlagsAsync()`, and `overrideFeatureFlag()` in favor of `updateFlags()`. In React Native, also deprecate the `useFeatureFlagWithPayload()` hook in favor of `useFeatureFlagResult()`. They continue to work.
