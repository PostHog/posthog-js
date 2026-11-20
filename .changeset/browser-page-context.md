---
'@posthog/browser': minor
'@posthog/browser-common': patch
---

Add the page URL, host and path to every `@posthog/browser` event and the title to pageviews, with `urlSanitization` to choose which URL parts are kept for events, logs, web vitals and session replay. Fragments are dropped by default.
