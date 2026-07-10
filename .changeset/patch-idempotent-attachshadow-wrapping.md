---
'@posthog/rrweb-utils': patch
'@posthog/rrweb': patch
'@posthog/rrweb-record': patch
'posthog-js': patch
---

Fix a `RangeError: Maximum call stack size exceeded` originating from the shared rrweb `patch()` helper. It patches shared globals such as `Element.prototype.attachShadow` (shadow-dom-manager) and the DOM/canvas observers, so multiple recorder instances or repeated start/stop cycles wrap the same global more than once. Previously an out-of-order restore silently no-op'd, leaving the wrapper in the call path; repeated cycles grew the wrapper chain without bound until a real call walked a chain deep enough to overflow the stack. Wrappers now delegate through a mutable per-layer link so any layer can be torn down even when newer wrappers sit on top of it, keeping the chain bounded. Recording behavior is unchanged. This applies the same fix as #4063 (fetch/XHR) to the shared helper so every rrweb-record caller inherits the bounded-chain behavior.
