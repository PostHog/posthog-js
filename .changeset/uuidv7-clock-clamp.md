---
'@posthog/browser-common': patch
'posthog-js': patch
---

Prevent invalid clock values from breaking UUID generation and continue capturing replay chunks after a chunk fails.
