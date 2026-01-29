---
'posthog-node': patch
---

fix: before_send in node inferred the type as any instead of EventMessage or null
