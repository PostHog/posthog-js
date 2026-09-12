---
'posthog-js': patch
---

Keep the session recording observers that started when one of them fails to initialize, and report the failed observers in the recorder debug properties.
