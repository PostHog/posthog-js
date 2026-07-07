---
'posthog-js': patch
---

Stop posthog-js's own request-timeout aborts from being captured as `$exception` events in error tracking. When our request timeout elapses we abort the in-flight fetch with an intentional, benign `AbortError` (the request queue retries), but Chromium surfaces the abort reason as an unhandled promise rejection, so it reached error tracking via the autocapture unhandled-rejection wrapper. These aborts are now suppressed at the exception capture path so they never become captured exceptions.
