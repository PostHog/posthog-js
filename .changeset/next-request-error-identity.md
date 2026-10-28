---
'@posthog/next': patch
---

fix: `onRequestError` takes identity from PostHog tracing headers before the cookie, ignores an expired cookie session, and adds the request URL, method, path and user agent to the exception
