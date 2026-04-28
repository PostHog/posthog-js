---
'posthog-js': patch
---

Add a back-compat shim for `window.extendPostHogWithExceptionAutocapture` so cached pre-`aaded54` (#1407) core bundles loading a current exception-autocapture extension script no longer throw `TypeError: extendPostHogWithExceptionAutocapture is not a function` from the lazy loader's onload callback.
