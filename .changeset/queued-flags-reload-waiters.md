---
"@posthog/core": patch
---

Fix `reloadFeatureFlagsAsync` and `reloadFeatureFlags` resolving with flags evaluated before the caller's person properties were set
