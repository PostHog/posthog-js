---
'posthog-js': patch
'@posthog/core': patch
---

Drop uncaught exceptions thrown by Safari browser extensions: keep the location `window.onerror` reports when the Error carries no stack, and treat a stack of masked frames with no frame the app loaded as an extension exception.
