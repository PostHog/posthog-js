---
'posthog-node': minor
---

Add `posthog.push.send()` to send transactional push notifications from a PostHog push template to every device of one person. It uses the client's `secretKey` (a project secret API key with the `transactional_push:write` scope), `appHost`, and email request timeout and retries.
