---
'@posthog/core': patch
'posthog-js': patch
---

Recognise Firefox and Safari extension frames when filtering extension exceptions, and stop counting Safari's masked `webkit-masked-url://` frames as in-app code.
