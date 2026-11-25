---
'posthog-node': minor
---

feat: add experimental `createReactRouterErrorHandler` to capture React Router server errors with the request's person, session and page URL. Linking page loads to the browser session reads the posthog-js cookie, which needs `readPostHogCookie: true`.
