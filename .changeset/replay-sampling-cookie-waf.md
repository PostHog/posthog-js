---
'posthog-js': patch
---

Fixed requests being blocked by web application firewalls running the OWASP Core Rule Set (ModSecurity and others) for visitors whose session was sampled out of session replay. The `ph_<token>_posthog` cookie stored that decision with a `!` prefix that rule 942190 flags as SQL injection. The decision now uses a plain letter, and this version removes old `!` values from the cookie on the next page load, whether or not replay starts on that page. Versions before 1.417.0 that load the unversioned recorder from the PostHog CDN stop writing new `!` values without upgrading, but only replace old ones on pages where the recorder loads.
