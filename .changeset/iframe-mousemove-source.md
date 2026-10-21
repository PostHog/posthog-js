---
'posthog-js': patch
---

Session replay records mouse movement inside same-origin iframes as mouse movement instead of touch movement, so the replay cursor stays visible.
