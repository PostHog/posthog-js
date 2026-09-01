---
'posthog-js': minor
'posthog-js-lite': minor
'@posthog/core': minor
---

Detect the Claude, Codex, and ChatGPT apps from their user agent markers: `$browser` now reports the app name instead of `Chrome`.

ChatGPT versions its apps differently per platform, so its `$browser_version` is not comparable across platforms.
