---
'@posthog/core': patch
'posthog-js': patch
---

Fix error tracking coercion reporting the wrong exception type for non-`Error` objects (e.g. `TypeError`, `ReferenceError`) that are thrown by browser extensions or other cross-realm code. Previously these always reported as type `Error`, burying the real type in the message string. Also fixed a local `isError` helper shadowing the more robust cross-realm-aware implementation, which caused some errors thrown from iframes or extension isolated worlds to be misclassified.
