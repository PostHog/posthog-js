---
'@posthog/core': patch
'@posthog/browser-common': patch
'@posthog/browser': patch
'posthog-js': patch
'posthog-node': patch
'posthog-react-native': patch
'posthog-js-lite': patch
---

Treat failed feature flag evaluations as unavailable without exposing their values or payloads.
