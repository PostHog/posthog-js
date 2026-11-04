---
'posthog-node': minor
---

Read the `/flags?v=4` response. Flag getters and `$feature_flag_called` events return the same values as before, and a flag record with a field of the wrong JSON type now fails only that flag.
