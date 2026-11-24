---
'posthog-node': minor
---

feat: add experimental `createReactRouterErrorHandler` and `captureRequestException` to capture server errors from fetch API requests with the request's person, session and page URL. Linking page loads to the browser session reads the posthog-js cookie, which needs `readPostHogCookie: true`.
