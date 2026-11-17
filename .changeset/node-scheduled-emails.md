---
'posthog-node': minor
---

Schedule an email up to 30 days ahead with `scheduledAt` on `posthog.emails.send()`, then move it with `posthog.emails.update()`, stop it with `posthog.emails.cancel()`, or list what waits with `posthog.emails.list({ status: 'scheduled' })`. Earlier releases don't take `scheduledAt`: from 5.62.0 they refuse it before any request, and before 5.62.0 they drop it and send at once.
