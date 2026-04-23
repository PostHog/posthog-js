---
'posthog-js': patch
---

fix(toolbar): swallow synchronous errors thrown by the external `ph_load_toolbar` bundle (e.g. `TypeError: Failed to fetch`) so they are logged via the toolbar logger instead of bubbling up as unhandled exceptions.
