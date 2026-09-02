---
'posthog-node': patch
'posthog-react-native': patch
'@posthog/core': patch
---

Honor `Retry-After` when the ingestion endpoint refuses a logs, metrics or traces batch, rather than retrying on the SDK's own backoff alone. The header acts as a floor, so a shorter value never makes the SDK retry sooner than it would have, and a wait longer than five minutes is capped.

In `posthog-node`, `flush()` now leaves spans queued while such a wait is open instead of exporting them, so a service that flushes on every request cannot exhaust a batch's retry budget inside a window where every attempt is refused. Shutdown still exports.
