---
'posthog-node': minor
---

Send one email to each of up to 100 recipients with `posthog.emails.batch()`. It sends them in one request, retries a failed request with the same idempotency keys like `emails.send()`, and returns what happened to each recipient.

`emails.send()` now refuses an inherited or non-enumerable field its form does not take, such as `templateData` on a send with `templateKey`, as it does an own one.
