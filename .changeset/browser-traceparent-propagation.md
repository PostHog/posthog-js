---
'posthog-js': minor
'@posthog/types': minor
---

Add `trace_propagation_targets`: an opt-in allowlist of hostnames or origins that receive a W3C `traceparent` header on `fetch` and `XMLHttpRequest` requests, so backend traces can continue from the browser. Unlisted hosts never get the header, and a `traceparent` set by the app or by OpenTelemetry instrumentation is never overwritten or duplicated.
