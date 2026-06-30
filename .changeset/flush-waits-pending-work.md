---
"@posthog/core": patch
"posthog-node": patch
---

Make Node `flush()` wait for pending asynchronous SDK work before draining the event queue, so events produced by helpers like `captureException()` are not missed. Pending work rejections no longer prevent queued events from flushing.
