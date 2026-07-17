---
'posthog-js': patch
---

Internal restructuring of remote config failure handling across SDK extensions; no behavior change. A failed config fetch also no longer overwrites the config cached for session recording replay in cookieless mode.
