---
'posthog-js': patch
---

Take a full snapshot when session recording wakes from idle if DOM mutations were dropped while idle, so replay no longer shows duplicated or overlapping DOM after an idle period.
