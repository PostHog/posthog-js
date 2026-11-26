---
'posthog-node': patch
---

Skip each group condition without a usable group key instead of returning `false` for the whole group flag, so a person condition in a group flag still matches. A group flag with a holdout and no usable group key now falls back to `/flags` instead of resolving locally.
