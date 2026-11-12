---
'posthog-react-native': major
---

- **Breaking:** `onFeatureFlags` listeners receive a second argument, `{ errorsLoading }`, which is `true` when the latest feature flag load failed; the flags passed with it are the last known values
- **Breaking:** a feature flag payload that isn't valid JSON, including an empty one, reads as `null` instead of its raw string
- **Breaking:** remove `getFeatureFlagPayload()` — use `getFeatureFlagResult(key, { sendEvent: false })?.payload`
- **Breaking:** remove `getFeatureFlags()`, `getFeatureFlagPayloads()` and `getFeatureFlagsAndPayloads()` — use `getAllFeatureFlags()`
- **Breaking:** remove `onFeatureFlag()` — use `onFeatureFlags()` and read the flag with `getFeatureFlagResult()`
- **Breaking:** remove `overrideFeatureFlag()` — use `updateFlags()`, and set `disableRemoteFeatureFlags` to keep the values from being replaced by the next load
- **Breaking:** remove the `useFeatureFlagWithPayload()` hook — use `useFeatureFlagResult()`
