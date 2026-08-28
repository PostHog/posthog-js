---
'posthog-js': patch
---

Preserve universally safe JSON-LD properties and allowlisted tree structure when replay redacts the other fields. Drop unlisted property branches, and keep JSON-LD IDs only as fragments that match captured DOM element IDs.
