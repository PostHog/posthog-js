---
'@posthog/core': minor
'posthog-react-native': minor
'posthog-js-lite': minor
'posthog-js': minor
'@posthog/types': minor
---

feat: add a default-value option to `isFeatureEnabled`

`isFeatureEnabled(key, { defaultValue: false })` now returns the given default when the flag has no value — flags not loaded yet, or no flag with that key — and the return type narrows to `boolean`. The option name is the same in posthog-js, posthog-js-lite, and posthog-react-native. Without `defaultValue`, behavior is unchanged: `boolean | undefined`.
