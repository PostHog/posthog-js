---
'posthog-js': patch
---

Reduce session replay DOM traversal overhead by reusing native-accessor cache keys instead of constructing a new string for every node access.
