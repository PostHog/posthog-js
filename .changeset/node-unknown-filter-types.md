---
'posthog-node': patch
---

Local evaluation treats a filter type it can't evaluate, such as a cohort's `person_metadata` filter on first seen, as unsupported and falls back to `/flags`, instead of matching it against a person property with the same key
