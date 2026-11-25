---
'@posthog/browser-common': patch
'posthog-js': patch
'@posthog/browser': patch
---

Stop counting the browser's forwarded click from a `<label>` as a second click, so clicking a label no longer triggers a false rage click
