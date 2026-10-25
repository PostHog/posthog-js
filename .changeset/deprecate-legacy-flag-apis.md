---
'@posthog/core': patch
'posthog-react-native': patch
'posthog-js-lite': patch
---

Deprecate `getFeatureFlags()`, `getFeatureFlagPayloads()`, `getFeatureFlagsAndPayloads()` and `getFeatureFlagDetails()` in favor of `getAllFeatureFlags()` and `getFeatureFlagResult()`, `onFeatureFlag()` in favor of `onFeatureFlags()`, and the `cb` option of `reloadFeatureFlags()` in favor of `reloadFeatureFlagsAsync()`. They continue to work.
