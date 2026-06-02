---
'posthog-js': minor
'@posthog/types': minor
---

Add `__preview_cookie_wins_on_conflict` opt-in config to prefer cookie values over localStorage when merging persistence state in `localStorage+cookie` mode, fixing cross-subdomain identify and session disconnects.
