---
'posthog-js': patch
---

Reduce session recording overhead when DOM subtrees are moved repeatedly by avoiding per-node traversal callbacks.
