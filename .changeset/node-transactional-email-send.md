---
'posthog-node': minor
---

Send transactional email from a PostHog email template with `posthog.emails.send()`, using the new `appHost`, `emailRequestTimeoutMs` and `emailRequestMaxRetries` client options. Read what happened to a sent email with `posthog.emails.get(id)`, using the message ID that `send()` returned.
