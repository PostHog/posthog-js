---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Add distributed tracing to `posthog-node` — experimental. `startSpan`, `withSpan` and `getActiveSpan` record spans against a new `traces` client option, and return a working handle even before it is set, so calling code never branches on whether tracing is on. Spans started inside a request context carry the distinct ID and session ID; `parent` and `span.traceparent()` continue a W3C trace across services, inbound sampled flag included; `flush()` drains queued spans alongside events.

Configure it through `traces`: `serviceName`, `serviceVersion`, `environment` and `resourceAttributes` for attribution (spans also report the host's `os.name` and `os.version`), `beforeSpanSend` to edit or drop a finished span, `flushIntervalMs` / `maxExportBatchSize` / `maxQueueSize` for export, and `maxAttributesPerSpan` (128), `maxEventsPerSpan` (128), `maxAttributesPerEvent` (128), `maxAttributeValueLength` (8192), `maxLiveSpans` (10000) and `maxSpanAgeMs` (one hour) to bound what instrumentation can accumulate. `span.recordException()` and a throwing `withSpan` callback attach `exception.type`, `exception.message` and `exception.stacktrace` — drop the stack in `beforeSpanSend` to keep your server's file paths out of PostHog.

`IPostHog` gains `startSpan`, `withSpan` and `getActiveSpan`, so anything implementing that interface (hand-written test doubles, DI wrappers) needs them added, or can extend `PostHogBackendClient` instead.
