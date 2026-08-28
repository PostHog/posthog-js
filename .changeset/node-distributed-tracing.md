---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Add distributed tracing to `posthog-node` — experimental. `withSpan`, `startSpan` and `getActiveSpan` record spans against a new `traces` client option; spans started inside a request context carry the distinct ID and session ID, and `parent` / `span.traceparent()` continue a W3C trace across services.

`IPostHog` gains these three members, so anything implementing that interface (hand-written test doubles, DI wrappers) needs them added, or can extend `PostHogBackendClient` instead.
