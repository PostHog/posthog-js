---
'posthog-js': patch
---

Fix `logs.captureConsoleLogs` set in `init()` not enabling console autocapture, and capture `console` calls made before the logs script loads
