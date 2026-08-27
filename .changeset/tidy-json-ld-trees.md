---
'posthog-js': patch
---

Preserve universally safe JSON-LD properties and their tree structure when replay redacts the other fields. Keep JSON-LD IDs only as fragments that match captured DOM element IDs.
