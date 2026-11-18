---
'@posthog/browser': minor
---

Make the client the single extension host: analytics operations move onto the client, group and person helpers move to `@posthog/browser/groups` and `@posthog/browser/person`, and `@posthog/browser/lite` adds a best-effort delivery entrypoint.
