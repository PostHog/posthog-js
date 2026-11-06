---
'@posthog/core': patch
---

Let an SDK choose the `/flags` response version it requests and how it reads it. SDKs that do not opt in keep requesting `v=2`.
