---
'posthog-node': minor
---

`posthog.emails.send()` also sends a local template: a send with `templateKey` and `templateData` names content from your code that PostHog fills in. The SDK uploads the template whenever PostHog doesn't hold its content yet, such as on its first send or after the content changed. A local template needs `html`.
