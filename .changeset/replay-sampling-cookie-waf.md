---
'posthog-js': patch
---

Fixed requests being blocked by web application firewalls running the OWASP Core Rule Set (ModSecurity and others) for visitors whose session was sampled out of session replay. The `ph_<token>_posthog` cookie stored that decision with a `!` prefix that rule 942190 flags as SQL injection; the cookie value now uses a plain letter, and existing cookies are rewritten on the next page load. Versions from 1.417.0 on need this release; older versions that load the recorder from the PostHog CDN pick up the fix without upgrading.
