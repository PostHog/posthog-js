---
'posthog-js': minor
'posthog-js-lite': minor
'@posthog/core': minor
'@posthog/types': minor
'@posthog/browser-common': patch
---

feat(browser): detect Facebook and Instagram in-app browsers

The Android Facebook in-app browser (`FB_IAB`/`FBAV`) reported as Chrome and the Instagram in-app browser reported as Chrome on Android and Mobile Safari on iOS, because `detectBrowser` only matched the iOS Facebook `FBIOS` marker. Both now resolve to `Facebook Mobile` and `Instagram`. In `posthog-js` this is opt-in behind the new `detect_meta_in_app_browsers` config, on by default from the `2026-08-30` config defaults, so live `$browser` shares do not shift without opting in.
