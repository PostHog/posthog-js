---
"@posthog/core": patch
---

Fix `reloadFeatureFlagsAsync` and `reloadFeatureFlags` resolving with flags evaluated before the caller's latest identity or property changes
