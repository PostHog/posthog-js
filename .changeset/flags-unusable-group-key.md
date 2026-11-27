---
'posthog-node': patch
---

Treat an empty, null, boolean, array or object group key as no group key in local flag evaluation, so its group conditions don't match.
