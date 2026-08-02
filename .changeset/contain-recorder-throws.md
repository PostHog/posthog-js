---
'posthog-js': patch
'@posthog/rrweb': patch
---

Register an `errorHandler` when starting the session recorder so a failure inside any recorder callback is contained instead of becoming an uncaught error on the host page, and guard the mutation-processing path against reading native DOM accessors on a non-native `this` (e.g. a proxy or cross-realm node), which could throw `Illegal invocation`.
