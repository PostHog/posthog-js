---
'posthog-js': patch
---

fix(conversations): re-attach the support widget after SPA navigations that replace `document.body` (e.g. Turbo Drive), so the widget no longer disappears until a full page reload
