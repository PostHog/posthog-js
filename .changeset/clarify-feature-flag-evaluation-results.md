---
'posthog-js': patch
'posthog-node': patch
'posthog-react-native': patch
'@posthog/core': patch
'@posthog/nuxt': patch
'@posthog/openfeature-node-provider': patch
'@posthog/openfeature-web-provider': patch
'@posthog/react': patch
'@posthog/types': patch
---

Clarify feature flag return-value terminology across SDK APIs. A `false` value is a conclusive off evaluation, while `undefined` means no evaluation is available. Remote evaluation omits globally inactive flags, whereas backend local evaluation can resolve cached inactive definitions to `false`.
