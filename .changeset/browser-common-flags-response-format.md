---
'@posthog/browser-common': patch
---

Let a browser SDK choose the `/flags` response version it requests and how it reads it. SDKs that do not opt in keep requesting `v=2`.
