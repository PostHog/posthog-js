---
'posthog-js': patch
---

Fix `logs.captureConsoleLogs` set in `init()` not enabling console autocapture, capture `console` calls made before the logs script loads, and drop captured console records when the user opts out
