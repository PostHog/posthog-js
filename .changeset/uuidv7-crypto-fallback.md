---
'@posthog/browser-common': patch
'posthog-js': patch
---

Fall back to `Math.random` when `crypto.getRandomValues` throws, so UUID generation no longer breaks capture.
