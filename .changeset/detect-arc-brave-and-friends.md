---
'posthog-js': minor
'@posthog/core': minor
---

Detect Arc, Brave (desktop, Android, iOS), Vivaldi, Yandex, Naver Whale, DuckDuckGo, Pale Moon, and Waterfox so users on these browsers no longer get bucketed as Chrome or Firefox.

`detectBrowser` / `detectBrowserVersion` now accept an optional third argument, `BrowserDetectionHints`, with two boolean flags: `arc` (set when Arc's `--arc-palette-title` CSS custom property is present on `document.documentElement`) and `brave` (set when `navigator.brave` exists). The browser SDK populates these automatically. Brave on iOS is picked up purely from the `Brave/` UA marker — WebKit doesn't ship `navigator.brave`. The original two-argument signature still works for non-DOM callers.
