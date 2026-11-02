---
'posthog-node': patch
---

`posthog.emails.send()` now sends a flat request body with `template_id` and `distinct_id` at the top level.
