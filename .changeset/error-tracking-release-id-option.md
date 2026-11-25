---
'posthog-js': minor
'@posthog/types': minor
---

Add `error_tracking.release_id` to set the `$release_id` of exception events at init, for apps that only know their release at startup. A build-time injected release id still takes precedence, and a `$release_id` passed to `captureException` or registered as a super property is no longer overwritten.
