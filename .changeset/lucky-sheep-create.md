---
'posthog-js': patch
---

checks for session activity in other windows when timing out in any particular window, avoids a race condition when proactively marking a session as idle
