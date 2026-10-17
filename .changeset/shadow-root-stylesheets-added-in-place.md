---
'posthog-js': patch
---

Fix shadow DOM styles missing from session replays when a page adds stylesheets with `adoptedStyleSheets.push()`, as Stencil and Ionic components do.
