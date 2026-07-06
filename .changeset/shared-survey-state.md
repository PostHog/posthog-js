---
'@posthog/core': patch
'posthog-js': patch
---

chore: survey seen-key and repeat-activation helpers now live in @posthog/core, shared by the web and React Native SDKs. Core's survey enums are now const-object literal unions (matching the web SDK's existing pattern), so the same values type-check across both SDKs. No behavior change.
