---
'posthog-node': minor
---

Opt a recipient out of email topics, or back in, with `posthog.emails.setPreferences({ to, topics, allMarketing })`. One call sends the whole change in one request, using the client's `secretKey`.
