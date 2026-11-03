---
'@posthog/next': minor
---

feat: `onRequestError` takes identity from PostHog tracing headers before the cookie, drops a cookie session that posthog-js would have ended, and adds the request URL, method, path and user agent. New `withPostHogProxy` captures errors thrown in `proxy.ts` or middleware without delaying the response. Errors that escape middleware or a proxy are marked unhandled.
