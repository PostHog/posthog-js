---
'posthog-node': minor
---

feat(node): add `instrumentRequest` and `posthogHonoMiddleware` for fetch-API servers (Hono, Bun, Deno, Next route handlers). They read `x-posthog-session-id`, wrap the request in `withContext`, open a server span that continues `traceparent` and is named by route, mark 5xx as errors, and record `http.server.request.duration` and `http.server.request.count`.
