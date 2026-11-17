---
'@posthog/core': minor
---

- Accept `sendFeatureFlagEvent` as the per-call option of `getFeatureFlag()`, `getFeatureFlagResult()` and `isFeatureEnabled()`; it takes precedence over `sendEvent`
- Add `PostHogCoreBase`, the client core without `getFeatureFlagPayload()`, `getFeatureFlagPayloads()`, `getFeatureFlags()`, `getFeatureFlagsAndPayloads()`, `onFeatureFlag()`, `overrideFeatureFlag()` and `onFeatureFlags()`, so an SDK can define its own `onFeatureFlags()` callback; `PostHogCore` keeps them unchanged
- `PostHogCoreBase` lets a registered or caller `$is_identified` win, leaves a registered `$process_person_profile` off identity events and stamps person state on `$autocapture` events; `PostHogCore` keeps its behavior
- Add `withoutNullMembers()`, which removes `null` and `undefined` object members recursively without changing array positions
