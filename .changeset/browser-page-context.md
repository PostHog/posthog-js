---
'@posthog/browser': minor
'@posthog/browser-common': patch
---

Add the page URL, host and path to every `@posthog/browser` event and the title to pageviews, with `urlSanitization` to choose which URL parts are kept for events, logs, web vitals and session replay. Fragments are dropped by default.

Breaking for 0.4.x users: the logs `urlCapture` option and `UrlCaptureOptions` type are removed. Logs' `url.full` now follows `urlSanitization` and includes the query string by default; set `urlSanitization: { query: false }` to drop it. See the package README's "Migrating from the analytics extension" section.
