---
'posthog-js': patch
'@posthog/browser-common': patch
---

Share surveys across browser SDKs; calls to `getSurveys` before survey setup now invoke the callback immediately with an unavailable error.
