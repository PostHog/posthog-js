---
'posthog-node': patch
---

Send transactional email requests to `/api/messaging/` instead of the `/api/projects/@current/` alias, which PostHog is removing.
