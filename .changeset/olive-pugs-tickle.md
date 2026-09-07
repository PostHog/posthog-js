---
'posthog-js': patch
---

Prevent exception autocapture from throwing when the handler it wraps belongs to another compartment or a destroyed document.
