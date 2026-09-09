---
'posthog-js': patch
---

Keep the same `sent_at` on every retry of a capture request, so the server can deduplicate a retried event it already stored.
