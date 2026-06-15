---
'posthog-js': minor
'@posthog/types': minor
---

Add a `flags_request_path` config option to route feature flag requests via a custom path instead of the default `/flags`. Some ad blockers block the `/flags` path on any domain, which a reverse proxy alone doesn't fix because it only changes the host. Point `flags_request_path` at a path your reverse proxy maps to PostHog's flags endpoint to avoid the block. Defaults to `/flags/`, so existing behavior is unchanged.
