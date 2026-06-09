---
'posthog-js': minor
'@posthog/core': minor
'@posthog/types': minor
---

Detect the Google Search App (GSA) as its own `$browser` value (`Google Search App`) via the cross-platform `GSA/` UA marker, instead of reporting the embedded webview as Mobile Safari (iOS) or Chrome (Android). Gated behind the new `detect_google_search_app` config option, which the `2026-05-30` config defaults opt into automatically — left off otherwise to keep existing browser attribution backwards-compatible.

Note: `$browser_version` for `Google Search App` is not comparable across platforms — iOS yields a version like `284.0` (from `GSA/284.0.564099828`) while Android yields a version like `14.21` (from `GSA/14.21.20.28.arm64`), since Google maintains separate versioning schemes for the two apps. Avoid building cross-platform version dashboards on `$browser_version` for this browser.
