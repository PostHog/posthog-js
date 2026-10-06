---
'posthog-js': patch
---

Inject WebMCP intent and model fields into schemas that omit `additionalProperties`, and skip schemas with constraints that the fields could break.
