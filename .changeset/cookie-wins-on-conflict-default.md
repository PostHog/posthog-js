---
'posthog-js': patch
'@posthog/types': patch
---

Make the shared cross-subdomain cookie win over per-origin localStorage by default when `config.defaults` is `'2026-08-29'` or later.

In `'localStorage+cookie'` persistence mode, `createLocalPlusCookieStore` merged localStorage over the cookie, so per-origin localStorage overrode the cookie that is shared across subdomains. A visitor who already had state on one subdomain kept a stale `distinct_id`, `$device_id`, and `$session_id` after arriving from another subdomain, which split landing-page visits from later conversions. This behavior was previously only reachable through the opt-in `__preview_cookie_wins_on_conflict` flag; the new `'2026-08-29'` defaults date turns it on for new installs. The SDK now also logs a debug warning when a shared cookie `distinct_id` differs from localStorage and the cookie wins.
