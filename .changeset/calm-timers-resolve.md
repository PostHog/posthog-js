---
'@posthog/core': patch
'posthog-node': patch
---

Log shutdown timeouts without rejecting, and correct the Node.js `shutdown()` return type to `Promise<void>`.
