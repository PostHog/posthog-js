---
'@posthog/core': patch
'posthog-react-native': patch
'posthog-js-lite': patch
---

Deprecate `getFeatureFlags()`, `getFeatureFlagPayloads()` and `getFeatureFlagsAndPayloads()` in favor of `getAllFeatureFlags()`, `onFeatureFlag()` in favor of `onFeatureFlags()`, and the `cb` option of `reloadFeatureFlags()` in favor of `reloadFeatureFlagsAsync()`. In React Native, also deprecate the `useFeatureFlagWithPayload()` hook in favor of `useFeatureFlagResult()`. They continue to work.
