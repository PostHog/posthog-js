---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Add distributed tracing to `posthog-node` — experimental. `withSpan`, `startSpan` and `getActiveSpan` record spans against a new `traces` client option; spans started inside a request context carry the distinct ID and session ID, and `parent` / `span.traceparent()` continue a W3C trace across services.

Code that starts spans and never ends them cannot grow the SDK's bookkeeping without limit: `traces.maxLiveSpans` (default 10000) caps how many spans may be open at once, and `traces.maxSpanAgeMs` (default one hour) stops accounting for one that stays open longer than that. `startSpan` returns an inert handle at the cap, and both kinds of drop are reported through the existing span-drop warning.

`IPostHog` gains these three members, so anything implementing that interface (hand-written test doubles, DI wrappers) needs them added, or can extend `PostHogBackendClient` instead.
