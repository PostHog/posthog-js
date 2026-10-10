---
'posthog-node': minor
---

Reads from an `evaluateFlags()` snapshot now honor `sendFeatureFlagEvent: false`, and `isEnabled()` / `getFlag()` accept a `sendFeatureFlagEvents` option that overrides it for one read. If you set `sendFeatureFlagEvent: false` and rely on snapshot reads for experiment exposures, pass `sendFeatureFlagEvents: true` on those reads.
