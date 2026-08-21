---
'@posthog/core': patch
'posthog-js-lite': patch
'posthog-react-native': patch
---

Fix `reloadFeatureFlagsAsync` and `reloadFeatureFlags` resolving with flags evaluated before the caller's latest identity or property changes, and stop a queued remote-config reload from losing its config fetch when a plain reload arrives behind it
