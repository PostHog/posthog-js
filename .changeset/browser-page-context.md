---
'@posthog/browser': minor
'@posthog/browser-common': patch
---

Add the page URL, host and path to every `@posthog/browser` event and the title to pageviews, with `urlSanitization` to choose which URL parts are kept for events, logs and web vitals.
