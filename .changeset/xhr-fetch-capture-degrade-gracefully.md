---
'posthog-js': patch
---

fix(replay): harden session-replay network capture so instrumentation that throws (e.g. `new Request()` rejecting a URL/method) degrades gracefully and never breaks or misattributes the host application's own `xhr.open()` / `fetch()` calls
