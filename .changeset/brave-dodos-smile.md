---
'posthog-js': patch
---

Ship the package ESM entrypoint with an `.mjs` extension so Node recognizes its module format, while retaining the existing `.js` bundle for backwards compatibility.
