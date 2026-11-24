---
'@posthog/core': minor
---

Let SDKs on capture v1 keep only the events capture didn't accept, halve a batch after a 413, and cap batches by event bytes, through opt-in `sendBatch()` outcomes, batch byte and resend size hooks, and a hold on flushes that `shutdown()` waits out when it fits in its timeout; SDKs that don't use them are unchanged.
