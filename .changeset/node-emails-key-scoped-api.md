---
'posthog-node': patch
---

Send transactional email requests to `/api/messaging/` instead of the `/api/projects/@current/` alias, which PostHog is removing. Needs PostHog Cloud, or a self-hosted PostHog from 2026-11-18 or later. Older self-hosted versions answer these calls with a 404.
