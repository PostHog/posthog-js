---
'posthog-node': minor
---

`posthog.emails.send()` also sends email content from your code, named by a `templateKey`: rendered content as is, or a local template that PostHog fills with `templateData`. The SDK uploads a local template on its first send and whenever its content changes. Template sends by id move to the same send route, with no change for callers.
