---
'posthog-js': patch
'@posthog/react': patch
'@posthog/nuxt': patch
---

Document that a flag you disable in PostHog is not sent to the SDK at all, so `getFeatureFlag`, `isFeatureEnabled` and `useFeatureFlagEnabled` return `undefined` for it and not `false`. To get a hard `false`, keep the flag active with a 0% rollout, or supply a default where the API accepts one — `isFeatureEnabled(key, { defaultValue: false })` and React's `useFeatureFlagEnabled(key, false)`. `getFeatureFlag` and the Nuxt composable have no default option, so handle `undefined` yourself (for example with `?? false`).
