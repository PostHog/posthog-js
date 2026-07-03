---
'posthog-js': minor
---

Add a `disableAutofocus` survey appearance option. When set, open-text survey questions no longer steal focus when they render, which is useful for embedded (inline) surveys that shouldn't grab the caret or scroll the page on load. Defaults to `false`, preserving the existing autofocus behavior.
