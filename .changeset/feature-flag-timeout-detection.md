---
"posthog-js": patch
---

fix(web): detect our own feature-flag request timeouts via a `timedOut` flag instead of the abort reason, so they are logged at `warn` (not `error`) on browsers that don't propagate `controller.abort(reason)` — keeping benign timeouts out of error tracking's console-error capture
