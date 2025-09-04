---
'posthog-node': patch
---

`getFeatureFlag` and `isFeatureEnabled` now respect the `sendFeatureFlagEvent` client option if not explicitly specified when called.
