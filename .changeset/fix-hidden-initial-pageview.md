---
'posthog-js': patch
---

Fix `$pageview` being permanently dropped when a page loads in a background tab or is restored while hidden. The visibility gate now only defers the pageview for an actual Chrome prerender (via `document.prerendering`/`prerenderingchange`), instead of any page that isn't currently visible.
