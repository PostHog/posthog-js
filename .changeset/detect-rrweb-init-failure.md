---
"posthog-js": patch
---

Detect and report when rrweb fails to initialize. rrweb's `record()` silently swallows startup errors and returns `undefined`, which previously left the SDK reporting an active recording status while capturing zero data. The SDK now checks the return value and reports a new `rrweb_error` status, making the failure visible in debug properties.
