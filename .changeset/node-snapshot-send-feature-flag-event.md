---
'posthog-node': patch
---

Respect the `sendFeatureFlagEvent: false` client option when reading flags from an `evaluateFlags()` snapshot, so `isEnabled()` and `getFlag()` no longer send `$feature_flag_called` events.
