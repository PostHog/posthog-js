---
'@posthog/browser-common': patch
'posthog-js': patch
---

Send captured events even when an `eventCaptured` listener throws, and log the listener error.
