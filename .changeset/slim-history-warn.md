---
'posthog-js': patch
---

Warn once in the console, even outside debug mode, when `capture_pageview` is set to capture history changes but the history autocapture extension is not loaded, which drops SPA pageviews with the slim bundle.
