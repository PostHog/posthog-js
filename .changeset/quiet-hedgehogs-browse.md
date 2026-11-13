---
'posthog-docusaurus': patch
---

Prevent duplicate initial pageviews by skipping the route hook's initial call while preserving SDK pageleave and consent behavior.
