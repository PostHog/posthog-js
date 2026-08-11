---
'posthog-js': patch
'@posthog/types': patch
---

Add `cookieWinsOnConflict` to keep shared cross-subdomain identity and session state ahead of stale per-origin localStorage, deprecate `__preview_cookie_wins_on_conflict`, and enable the new behavior for the `2026-08-29` defaults.
