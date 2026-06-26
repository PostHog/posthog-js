---
'@posthog/core': minor
'posthog-js': minor
'posthog-react-native': minor
'posthog-js-lite': minor
---

Add `getAllFeatureFlags()`, which returns all currently loaded feature flags as structured `FeatureFlagResult`s (`key`, `enabled`, `variant`, `payload`). It is a synchronous read of the cached flags and does not send a `$feature_flag_called` event.
