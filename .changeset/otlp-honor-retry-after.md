---
'posthog-node': patch
'posthog-react-native': patch
'posthog-js': patch
'@posthog/core': patch
---

Honor `Retry-After` when the ingestion endpoint refuses a logs, metrics or traces batch, rather than retrying on the SDK's own backoff alone. The header acts as a floor, so a shorter value never makes the SDK retry sooner than it would have, and a wait longer than five minutes is capped.

The periodic flush waits the window out. An explicit `flush()`, and a flush a host runs to keep a request alive, still sends — a short-lived process is not left holding data it will never get another chance to deliver. Those attempts no longer count against a span batch's retry budget either, so waiting out a rate limit no longer drops spans.

In `posthog-js` the ingestion endpoint sends no `Retry-After`, so none of the above applies — but the log flush now keeps backing off while records are still arriving, instead of a new record resetting the retry to the flush interval. A failing endpoint is retried a handful of times over an outage rather than once per interval.
