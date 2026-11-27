---
'posthog-js': patch
---

Keep fragment-only and `blob:` URLs in CSS unchanged in session recordings, so SVG filters, masks and gradients referenced by `url(#id)` replay correctly.
