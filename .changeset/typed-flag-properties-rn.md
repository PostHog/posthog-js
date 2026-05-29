---
'posthog-react-native': patch
'@posthog/core': patch
---

fix(react-native): preserve non-string property types (booleans, arrays, numbers, objects) when caching person and group properties for feature flag evaluation. Previously these were force-coerced to strings via `String(value)`, causing flag conditions using boolean equality or array `contains` to fail on device while the PostHog UI still evaluated correctly.
