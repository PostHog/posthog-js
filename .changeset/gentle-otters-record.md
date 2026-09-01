---
'posthog-js': patch
---

Prevent stale session recorders from initializing after consent or session teardown, and dispose of recorders when switching to cookieless mode.
