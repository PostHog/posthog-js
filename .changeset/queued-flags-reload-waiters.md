---
"@posthog/core": patch
---

Fix `reloadFeatureFlagsAsync` resolving with flags evaluated before the caller's person properties were set
