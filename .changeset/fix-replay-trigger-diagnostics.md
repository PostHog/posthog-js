---
'posthog-js': patch
---

When session replay is waiting on a trigger, debug mode now names the conditions that haven't matched yet (for example `buffering: URL condition not matched`, or the named trigger group whose condition is pending) instead of only reporting `buffering`. Enable it with `posthog.debug()`. Logged once per change, not once per flush.
