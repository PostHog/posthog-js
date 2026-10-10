---
'posthog-js': patch
'@posthog/browser-common': patch
---

Warn in debug mode when `reloadFeatureFlags()` runs inside an `onFeatureFlags` callback, because cross-tab flag changes can turn it into a request loop
