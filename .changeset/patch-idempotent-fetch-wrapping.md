---
'posthog-js': patch
---

Fix a `RangeError: Maximum call stack size exceeded` that could originate from the shared `patch()` fetch/XHR wrapper. posthog-js wraps `window.fetch` in two independent places (tracing headers and session-recording network capture), so their restores routinely ran out of order. Previously an out-of-order restore silently no-op'd, leaving the wrapper in the call path; repeated start/stop cycles grew the wrapper chain without bound until a real `fetch` walked a chain deep enough to overflow the stack. Wrappers now delegate through a mutable link so any layer can be torn down even when newer wrappers sit on top of it, keeping the chain bounded. Header-injection and network-capture behavior is unchanged.
