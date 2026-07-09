---
"@posthog/core": patch
"posthog-react-native": patch
---

Coalesce concurrent flush requests to avoid chaining redundant flushes while offline.
