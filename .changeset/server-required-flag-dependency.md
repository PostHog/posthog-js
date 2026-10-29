---
'posthog-node': patch
---

fix: fall back to the server when a flag depends on a flag that only the server can evaluate (for example, one with a static cohort), instead of letting a later condition choose a different value locally. `unresolvedFlags` reports such a flag as `unresolved_dependency`
