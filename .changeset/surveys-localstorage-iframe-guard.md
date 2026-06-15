---
'posthog-js': patch
---

Surveys: guard the remaining unprotected `localStorage` accesses (`reset()` and the `lastSeenSurveyDate` write) so a `SecurityError` in cross-origin iframes is swallowed instead of bubbling up to user monitoring.
