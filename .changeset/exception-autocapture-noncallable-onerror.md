---
'posthog-js': patch
---

fix(exception-autocapture): don't throw when the page's onerror handler is non-callable

The wrapped `window.onerror`, `window.onunhandledrejection`, and `console.error` handlers
chained to the page's original handler using optional chaining, which only guards against
`null`/`undefined`. When a page had one of these set to a truthy non-callable value (e.g.
via `Object.defineProperty`, or clobbered by another script/extension), our wrapper threw a
`TypeError` from inside its own handler. We now check the original handler is actually
callable before invoking it and fall back to `false` otherwise.
