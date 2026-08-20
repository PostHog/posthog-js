---
'posthog-js': patch
---

Fix session replay shipping empty, unplayable recordings when a minimum duration is configured. Non-linking replay markers can no longer open a recording by themselves, while later custom events and session-linking markers continue to flush normally.
