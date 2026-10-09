---
'posthog-node': minor
---

The Express and NestJS integrations can read the session ID, and the distinct ID of an identified user, from the posthog-js cookie when a request has no tracing headers, so backend events link to browser sessions on same-site requests without frontend configuration. Turn it on with the `readPostHogCookie` option.
