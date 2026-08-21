---
'@posthog/browser-common': patch
'posthog-js': patch
---

Fix console log autocapture silently failing when an older `posthog-js` core loads a newer logs bundle, and expose host capture permission to extensions.
