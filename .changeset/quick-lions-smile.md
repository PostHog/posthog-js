---
'posthog-js': patch
---

fix(web-vitals): reduce memory leak in SPAs

- Upgrade web-vitals from v4.2.4 to v5.1.0 (includes internal memory fixes from v5.0.3)
- Remove duplicate observer creation on URL change

Note: web-vitals has inherent memory accumulation in SPAs due to internal state.
The v5 upgrade reduces this but doesn't fully eliminate it since web-vitals
doesn't provide cleanup functions (Issue #629 was closed as "not planned").
