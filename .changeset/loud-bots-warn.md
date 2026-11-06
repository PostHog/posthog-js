---
'posthog-js': patch
'@posthog/types': patch
---

Warn once in the console, even outside debug mode, when the bot user agent filter drops events, and document that `captureLog` logs bypass the filter.
