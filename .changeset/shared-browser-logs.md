---
'posthog-js': patch
'@posthog/browser-common': patch
---

Share browser logging across SDKs with consistent initialization and cleanup; `captureLog` and `logger` calls before logging setup are now dropped instead of buffered.
