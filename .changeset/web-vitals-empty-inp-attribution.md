---
"posthog-js": patch
---

Fix an uncaught `TypeError` in the web vitals attribution bundle. The attributed INP observer read `startTime` from the first entry without a guard, so a report with no entries (for example after a bfcache restore or soft navigation) threw and stopped the metric capture. Bump `web-vitals` to 6.0.0, which reports the metric without attribution when the entry list is empty.
