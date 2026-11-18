---
'posthog-js': patch
---

Fixed requests being blocked by web application firewalls running the OWASP Core Rule Set (ModSecurity and others) for visitors whose session was sampled out of session replay. Since 1.386.1, the `ph_<token>_posthog` cookie stored that decision with a `!` prefix that rule 942190 flags as SQL injection; the cookie value now uses a plain letter, and existing cookies are rewritten on the next page load.
