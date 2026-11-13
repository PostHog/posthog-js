---
'posthog-js': patch
---

record: throttle scroll events per element, so a resting scroll offset is no longer dropped when another element scrolls in the same 100ms window (e.g. Silk sheets on Safari before 26.2, which has no `scrollend`).
