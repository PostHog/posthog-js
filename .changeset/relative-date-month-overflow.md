---
'@posthog/core': patch
'posthog-node': patch
'@posthog/convex': patch
---

Relative date filters in local flag evaluation no longer roll past the end of a shorter month. `1m` on March 31 now resolves to February 28, matching the flags service.
