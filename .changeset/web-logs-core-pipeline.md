---
'posthog-js': minor
'@posthog/core': minor
'@posthog/types': minor
---

The browser's programmatic logs API (`posthog.captureLog()` / `posthog.logger.*`) now runs through the shared `@posthog/core` logs pipeline that React Native already uses — no change to the public API or existing behavior. Log delivery is more resilient as a result: oversized batches are split automatically, failed sends retry with exponential backoff, and delivery resumes when the browser comes back online.
