---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Add distributed tracing to posthog-node behind a new `traces` client option. `withSpan` / `startSpan` / `getActiveSpan` create OpenTelemetry-shaped spans that export to PostHog with no OpenTelemetry dependency, and spans created inside a request context automatically carry `posthogDistinctId` and `sessionId` so traces link back to people and sessions. Tracing stays off until `traces` is configured, and the API is marked `@experimental` while PostHog's tracing product is in beta.
