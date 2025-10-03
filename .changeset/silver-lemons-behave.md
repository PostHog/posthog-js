---
'posthog-js': patch
---

Fix delayed event flushing after `opt_in_capturing()` (fixes cookieless mode needing reload before events are captured)
