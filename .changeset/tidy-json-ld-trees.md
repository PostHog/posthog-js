---
'posthog-js': patch
'@posthog/types': patch
---

Preserve universally safe JSON-LD properties and allowlisted tree structure when replay redacts other fields. Keep only DOM-backed ID fragments. Limit types and payloads. Publish a reusable sanitization contract fixture.
