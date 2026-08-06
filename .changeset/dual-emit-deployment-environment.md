---
'@posthog/core': patch
'posthog-js': patch
---

Emit the deployment environment under both `deployment.environment.name` (semconv 1.27+) and the older `deployment.environment` for logs and metrics, and accept either spelling from `resourceAttributes`. Keeps environment filtering working for backends still reading the pre-1.27 key.
