---
'@posthog/next': minor
---

feat: rename `optOutByDefault` to `seedAnonymousCookie`

Renamed to better express what the option does: to control whether the middleware seeds a cookie containing an anonymous identifier on first page load.

Migration: replace `optOutByDefault: true` with `seedAnonymousCookie: false`.
