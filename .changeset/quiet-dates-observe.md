---
'@posthog/browser-common': patch
'@posthog/core': patch
'@posthog/rrweb-utils': patch
'posthog-js': patch
---

Fix dead-click false positives on WebKit when the SDK uses an iframe-sourced MutationObserver fallback.
