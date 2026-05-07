---
'posthog-js': minor
---

`capture()` now accepts an optional `uuid` on `CaptureOptions`, mirroring `posthog-node` (`EventMessage.uuid`) and `posthog-python` (`OptionalCaptureArgs.uuid`). When provided, it overrides the auto-generated `uuidv7()` for that event.

This unblocks the official idempotency pattern recommended in [posthog/posthog#17211](https://github.com/PostHog/posthog/issues/17211): emit a server-side webhook event and a browser-side success-page event for the same business transaction with a deterministic shared uuid (e.g. `uuidv5("${event}:${transaction_id}", NS)`) so PostHog's eventual deduplication can collapse them into one. Previously this was impossible from the browser SDK because every event was assigned a fresh `uuidv7()` inside `capture()` with no way for the caller to override.

```ts
posthog.capture('purchase', { transaction_id }, {
  uuid: deterministicUuid(eventName, transaction_id),
  timestamp: serverCanonicalTimestamp,
})
```

Closes #3546.
