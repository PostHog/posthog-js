---
'posthog-js': patch
---

Fix false dead clicks after synchronous DOM updates. Clicks stopped from bubbling are now evaluated too, which may increase dead-click counts for inert controls.
