---
'posthog-js': minor
'@posthog/browser-common': minor
---

Keep the space between an element's text nodes in `$el_text` when the page renders one, so `<button>Next <svg></svg> page</button>` is captured as "Next page" instead of "Nextpage".
