---
'@posthog/openfeature-node-provider': patch
---

When `sendFeatureFlagEvents` is not set, follow the posthog-node client's `sendFeatureFlagEvent` option instead of always sending `$feature_flag_called` events.
