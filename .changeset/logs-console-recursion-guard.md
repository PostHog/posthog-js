---
"posthog-js": patch
---

fix(web): prevent an infinite-recursion stack overflow in the logs console capture. The console wrapper's own capture path can emit internal debug lines through PostHog's logger, which wrote back to the wrapped console and re-entered capture until the stack blew (`RangeError: Maximum call stack size exceeded`). The wrapper now exposes the original console method via `__rrweb_original__` (so the internal logger bypasses it) and guards against re-entrancy from any code that logs mid-capture.
