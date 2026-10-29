---
'@posthog/next': patch
---

fix: `onRequestError` takes identity from PostHog tracing headers (including the window id) before the cookie, ignores an expired cookie session (`sessionIdleTimeoutSeconds` matches a custom posthog-js idle timeout), and adds the request URL, method, path and user agent to the exception. The URL and path keep the app's `basePath`, and the URL uses `X-Forwarded-Host`.
