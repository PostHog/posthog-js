---
'posthog-node': minor
---

Send one email to each of many recipients with `posthog.emails.batch()`. It sends 100 recipients per request, retries each request with the same idempotency keys, and returns what happened to each recipient.
