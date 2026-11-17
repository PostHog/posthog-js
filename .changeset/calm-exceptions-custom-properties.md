---
'posthog-node': patch
---

Drop null custom object properties without bypassing before_send redaction or changing array serialization. Prevent caller properties from overriding reserved exception metadata.
