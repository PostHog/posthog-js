---
'posthog-node': patch
---

fix: keep falsy payloads (`0`, `false`, `""`) for locally evaluated flags in `evaluateFlags`
