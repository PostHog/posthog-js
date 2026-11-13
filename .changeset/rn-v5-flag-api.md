---
'posthog-react-native': major
---

- **Breaking:** `onFeatureFlags` callbacks receive one object, `{ flags, variants, errorsLoading }`, like posthog-ios, posthog-android and posthog_flutter: `flags` lists the enabled flag keys, `variants` maps them to `true` or their variant, and `errorsLoading` is `true` when the latest load failed (the values are then the last known ones). Disabled flags are left out. Replace `onFeatureFlags((flags) => …)` with `onFeatureFlags(({ flags, variants, errorsLoading }) => …)`
- **Breaking:** a callback registered after flags have loaded is also called once with the current values, right after `onFeatureFlags` returns
- **Breaking:** a feature flag payload that isn't valid JSON, including an empty one, reads as `null` instead of its raw string
- **Breaking:** rename the per-call `sendEvent` option of `getFeatureFlag()`, `getFeatureFlagResult()` and `isFeatureEnabled()` to `sendFeatureFlagEvent`
- **Breaking:** remove `getFeatureFlagPayload()` — use `getFeatureFlagResult(key, { sendFeatureFlagEvent: false })?.payload`
- **Breaking:** remove `getFeatureFlags()`, `getFeatureFlagPayloads()` and `getFeatureFlagsAndPayloads()` — use `getAllFeatureFlags()`
- **Breaking:** remove `onFeatureFlag()` — use `onFeatureFlags()` and read the flag with `getFeatureFlagResult()`
- **Breaking:** remove `overrideFeatureFlag()` — use `updateFlags()`, and set `disableRemoteFeatureFlags` to keep the values from being replaced by the next load. Overrides set with it in 4.x are cleared on upgrade
- **Breaking:** remove the `useFeatureFlagWithPayload()` hook and its `FeatureFlagWithPayload` type — use `useFeatureFlagResult()`
- **Breaking:** remove the `useFeatureFlag()` hook — use `useFeatureFlagVariantKey(key)` for the value or `useFeatureFlagEnabled(key)` for on/off. For a flag that isn't in the loaded flags, both return `undefined` (or the default you pass to `useFeatureFlagEnabled()`) where `useFeatureFlag()` returned `false`
- **Breaking:** remove the `useFeatureFlags()` hook — use `useActiveFeatureFlags()` for the enabled flag keys
- Add the `useFeatureFlagEnabled()`, `useFeatureFlagVariantKey()`, `useFeatureFlagPayload()` and `useActiveFeatureFlags()` hooks, matching `@posthog/react`
