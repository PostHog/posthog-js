---
'posthog-js': minor
'@posthog/types': minor
---

Add `__preview_cookie_wins_on_conflict` config (opt-in). In `localStorage+cookie` persistence mode, identity keys like `distinct_id`, `$device_id`, `$session_id`, `$user_state`, and `$initial_person_info` are stored in both the cross-subdomain cookie and per-subdomain localStorage. On load they are merged with localStorage values winning, which can let a stale per-subdomain localStorage clobber a fresh cookie written by another subdomain — surfacing as cross-subdomain identify and session disconnects. When this preview flag is `true`, the cookie wins on conflict for the keys it stores; the merged value is written back to localStorage so stale state self-heals on the first load. Null and empty-string cookie values are filtered out before the merge so a malformed legacy cookie cannot override valid localStorage data. localStorage-only keys (flag caches, surveys, super properties) are unaffected. The flag is read once at SDK init when storage is built; it has no effect when set via `posthog.set_config` after init, and no effect for other persistence modes. This may become the default in a future major.
