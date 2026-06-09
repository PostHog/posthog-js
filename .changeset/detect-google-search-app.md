---
'posthog-js': minor
'@posthog/core': minor
'@posthog/types': minor
---

Detect the Google Search App (GSA) as its own `$browser` value (`Google Search App`) via the cross-platform `GSA/` UA marker, instead of reporting the embedded webview as Mobile Safari (iOS) or Chrome (Android). Gated behind the new `detect_google_search_app` config option, which the `2026-05-30` config defaults opt into automatically — left off otherwise to keep existing browser attribution backwards-compatible.
