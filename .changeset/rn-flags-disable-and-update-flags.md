---
'@posthog/core': minor
'posthog-react-native': minor
'posthog-js-lite': minor
---

Add a `disableRemoteFeatureFlags` option and a public `updateFlags(flags, payloads?, { merge })` method, for apps that evaluate feature flags outside the SDK (for example on their own backend) and want to supply the results at runtime instead of having the SDK fetch them.

With `disableRemoteFeatureFlags: true`, the SDK no longer fetches or evaluates feature flags from PostHog — `identify()`, `group()`, and `reset()` stop triggering `/flags` requests — while `getFeatureFlag()` and `getFeatureFlagPayload()` keep working against the values you supply. Provide those values (with optional payloads) at runtime via `updateFlags(flags, payloads?, { merge })`; they persist across restarts. This mirrors the web SDK's `advanced_disable_feature_flags` and `updateFlags`.
