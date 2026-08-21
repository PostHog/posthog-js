---
'@posthog/core': patch
'posthog-js-lite': patch
'posthog-react-native': patch
---

Fix `reloadFeatureFlags` and `reloadFeatureFlagsAsync` returning flags evaluated before the caller's most recent identity or person-property change when several reloads overlap, and stop overlapping reloads from skipping the remote config refresh
