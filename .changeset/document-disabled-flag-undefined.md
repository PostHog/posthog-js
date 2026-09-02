---
'posthog-js': patch
'@posthog/react': patch
'@posthog/nuxt': patch
---

Document that a flag you disable in PostHog is not sent to the SDK at all, so `getFeatureFlag`, `isFeatureEnabled` and `useFeatureFlagEnabled` return `undefined` for it and not `false`. To get a `false` value, pass a `defaultValue` or keep the flag active with a 0% rollout.
