---
'posthog-node': minor
---

The Express and NestJS integrations now read the distinct ID and the live session ID from the posthog-js cookie when the tracing headers are not present, so backend events link to browser sessions on same-site requests without frontend configuration.
