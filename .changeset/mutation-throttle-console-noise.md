---
'posthog-js': patch
---

Stop writing session replay mutation throttle warnings into the recording's own console stream, so they no longer bury a customer's real console output in the replay inspector. The warning still shows in the page's browser console when debug logging is on.
