---
'@posthog/core': patch
'posthog-js': patch
---

Preserve messages, source locations, and existing stacks from browser errors that do not provide a same-realm `Error` object.
