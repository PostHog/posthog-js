---
'@posthog/core': patch
'@posthog/browser-common': patch
'@posthog/browser': patch
'posthog-js': patch
'posthog-node': patch
'posthog-react-native': patch
'posthog-js-lite': patch
---

Treat failed flag evaluations as unavailable: Node `getFeatureFlag()`/`isFeatureEnabled()` return `undefined`, `getAllFlags()` omits failed keys, and no failed values or payloads are exposed.
