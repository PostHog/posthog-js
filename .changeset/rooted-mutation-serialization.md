---
'posthog-js': patch
---

Reduce session recording overhead on pages that add large DOM subtrees by serializing each new subtree from its root.
