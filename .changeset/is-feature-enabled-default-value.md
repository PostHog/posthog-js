---
'@posthog/core': minor
'posthog-react-native': minor
'posthog-js-lite': minor
'posthog-js': minor
'@posthog/types': minor
---

feat: add a default-value option to `isFeatureEnabled`

`isFeatureEnabled` now accepts a fallback value returned when the flag has no value — flags not loaded yet, or no flag with that key — and the return type narrows to `boolean`. In posthog-js the option is `{ default_value: false }`; in posthog-react-native and posthog-js-lite it is `{ defaultValue: false }`. Without it, behavior is unchanged: `boolean | undefined`.
