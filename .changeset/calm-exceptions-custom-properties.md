---
'posthog-node': patch
---

Drop null-valued custom exception properties after `beforeSend` without undoing redaction or changing array positions.
