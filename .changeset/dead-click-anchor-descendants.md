---
'posthog-js': patch
---

fix: don't report clicks on elements nested inside anchors, buttons, or other interactive elements as `$dead_click`. The detector now walks up the DOM to find an interactive ancestor, matching how autocapture already attributes clicks. This was causing false positives on pages where images or other non-interactive elements are wrapped in `<a>` tags (for example, sites built with Framer).
