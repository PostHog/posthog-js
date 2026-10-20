---
'posthog-js': patch
'@posthog/browser-common': patch
---

Share surveys across browser SDKs; `getSurveys` calls before survey setup now return an immediate unavailable error.
