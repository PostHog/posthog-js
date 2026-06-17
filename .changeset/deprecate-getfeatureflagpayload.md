---
'@posthog/core': patch
'posthog-react-native': patch
'posthog-js-lite': patch
---

Deprecate `getFeatureFlagPayload` in favor of `getFeatureFlagResult`, which returns the flag value and payload from a single evaluation. `getFeatureFlagPayload` continues to work.
