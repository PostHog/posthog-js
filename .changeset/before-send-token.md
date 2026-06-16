---
'@posthog/core': patch
'posthog-js': patch
---

Drop the event and log a warning when a `before_send` hook removes the `token` property, instead of silently sending an event that ingest rejects with a 401.
