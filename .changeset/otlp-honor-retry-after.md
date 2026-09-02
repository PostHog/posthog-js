---
'posthog-node': patch
'posthog-react-native': patch
'@posthog/core': patch
---

Honor `Retry-After` when the ingestion endpoint refuses a logs, metrics or traces batch, rather than retrying on the SDK's own backoff alone. The header acts as a floor, so a shorter value never makes the SDK retry sooner than it would have, and a wait longer than five minutes is capped.

The periodic flush waits the window out. An explicit `flush()` still sends, since it is a lifecycle or teardown boundary with no later attempt — but in `posthog-node` a refusal during the wait no longer counts against a span batch's retry budget, so a service that flushes on every request can no longer exhaust that budget and drop spans before the window has even elapsed.
