---
'posthog-js': minor
'@posthog/core': minor
---

Detect Brave (desktop, Android, iOS), Vivaldi, Yandex, Naver Whale, DuckDuckGo, Pale Moon, and Waterfox so users on these browsers no longer get bucketed as Chrome or Firefox.

`detectBrowser` / `detectBrowserVersion` now accept an optional third argument, `BrowserDetectionHints`, with a `brave` flag (set when `navigator.brave` exists). The browser SDK populates this automatically to catch desktop / Android Brave, which is Chromium-based and carries no UA marker. Brave on iOS is picked up purely from the `Brave/` UA marker — WebKit doesn't ship `navigator.brave`. The original two-argument signature still works for non-DOM callers.
