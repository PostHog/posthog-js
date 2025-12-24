---
'posthog-js': patch
---

Fix autocapture incorrectly blocking capture from elements with IDs/names containing sensitive looking substrings (e.g., `<a id="password">`). Sensitive data protection is maintained through element type checks and value pattern matching, as well as `ph-no-capture` element attributes.
