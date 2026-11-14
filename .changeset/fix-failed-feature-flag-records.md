---
'@posthog/core': minor
'@posthog/browser-common': minor
'@posthog/browser': minor
'posthog-js': minor
'posthog-node': minor
'posthog-react-native': minor
'posthog-js-lite': minor
---

Treat failed flag evaluations as unavailable: Node `getFeatureFlag()`/`isFeatureEnabled()` return `undefined`, `getAllFlags()` omits failed keys, and no failed values or payloads are exposed.
