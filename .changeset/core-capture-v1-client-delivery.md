---
'@posthog/core': minor
---

Let SDKs on capture v1 keep only the events capture didn't accept, halve a batch after a 413, and cap batches by event bytes, through opt-in `sendBatch()` outcomes, batch byte hooks and a hold on automatic flushes; SDKs that don't use them are unchanged.
