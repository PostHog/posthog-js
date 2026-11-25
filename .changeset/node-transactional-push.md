---
'posthog-node': minor
---

Add `posthog.push.send()` to send transactional push notifications from a PostHog push template to every device of one person, and `posthog.push.get()` to read what happened to one. They use the client's `secretKey` (a project secret API key with the `transactional_push:write` scope), `appHost`, and email request timeout and retries.
