---
'posthog-js': patch
---

Conversations widget: bullet and numbered lists in a support reply now keep their markers on host pages with an aggressive CSS reset (for example Tailwind preflight's `ol, ul { list-style: none }`). The widget renders into the host page's DOM, so the list style is now set inline on `<ul>`, `<ol>`, and `<li>` rather than left to the page's own styles.
