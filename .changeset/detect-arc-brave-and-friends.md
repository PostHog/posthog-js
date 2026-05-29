---
'posthog-js': minor
'@posthog/core': minor
---

Detect Arc, Brave, Vivaldi, Yandex, Naver Whale, DuckDuckGo, Pale Moon, and Waterfox so users on these browsers no longer get bucketed as Chrome or Firefox.

Arc and Brave deliberately hide themselves from the User-Agent string. `detectBrowser`/`detectBrowserVersion` now accept an optional third argument, `BrowserDetectionHints`, carrying `navigator.userAgentData.brands` and a `brave` flag (from the presence of `navigator.brave`). The browser SDK populates these automatically — no caller changes required. The existing two-argument signature still works for non-DOM callers.
