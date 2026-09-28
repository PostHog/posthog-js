---
'@posthog/browser-common': patch
'posthog-js': patch
---

Resolve `setTimeout`/`clearTimeout` through guarded helpers, so a realm without timers no longer throws a `ReferenceError` from the retry queue and stops every later retry on the page
