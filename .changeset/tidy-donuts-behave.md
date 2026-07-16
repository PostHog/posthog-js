---
'posthog-js': minor
'@posthog/types': minor
---

Added the `respect_gpc` config option. When `true`, users whose browser sends the Global Privacy Control signal (`navigator.globalPrivacyControl`) are treated as opted out of capturing, like `respect_dnt` does for the deprecated Do Not Track signal. Defaults to `false`.
