---
'posthog-node': minor
---

Send email content your code rendered with `posthog.emails.send()`: pass `templateKey`, `subject`, and `html`, `text` or both, with an optional `from` and `replyTo`. A send with `templateKey` captures engagement events unless it passes `captureEngagement: false`; a template made in PostHog follows the project setting. The new `migratedFrom` client option names the email provider you moved from.
