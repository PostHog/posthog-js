---
'posthog-js': patch
---

Conversations widget: treat a network-level message send failure (ad blocker, offline, CORS, page teardown) as transient — the widget now shows a "check your connection" message and logs at `warn` instead of `error`, so these benign failures no longer show up as captured exceptions in error tracking.
