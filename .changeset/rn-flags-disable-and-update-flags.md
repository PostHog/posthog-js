---
'@posthog/core': minor
'posthog-react-native': minor
'posthog-js-lite': minor
---

feat(flags): add the `advancedDisableFeatureFlags` option and a public `updateFlags(flags, payloads?, { merge? })` method, matching the web SDK's `advanced_disable_feature_flags` and `updateFlags`. With the option set, `reloadFeatureFlags()` and the reloads triggered by `identify()`, `group()`, `setPersonPropertiesForFlags()` and `reset()` become no-ops, and any flags request that still goes out for remote config or surveys carries `disable_flags: true` so the server skips flag evaluation. `updateFlags` supplies locally evaluated flag values (with payloads) at runtime: values persist, `getFeatureFlag()`/`getFeatureFlagPayload()` read them back, and `onFeatureFlags` listeners fire — so React Native session replay gated on a linked flag re-evaluates when flags are pushed in.
