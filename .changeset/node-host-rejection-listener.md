---
'posthog-node': patch
---

fix: exception autocapture now captures unhandled promise rejections when the app or framework (for example Next.js, Nitro or PM2) has its own `unhandledRejection` listener, without changing what Node does with the rejection. Each occurrence is captured once per project, however many clients the app creates, and `captureException` skips an error that autocapture is already reporting, for example one passed on by Nitro's error hook. A rejection is captured after a one-second grace period, or sooner on `flush()` or `shutdown()`, and not at all when the app handles it in that time. Next.js and React control-flow errors and `AbortError` rejections are skipped.
