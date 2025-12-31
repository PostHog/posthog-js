---
'posthog-js': minor
---

fix: Clear `PageViewManager` state on session rotation to prevent cross-session duration pollution

When a browser tab is backgrounded and the session rotates (30 min idle or 24 hour max), `PageViewManager` now clears its state. This prevents `$prev_pageview_duration` from spanning session boundaries, which was causing impossibly large values (94+ hours observed) in web analytics "Average Time on Page" metrics.

Users who implemented workarounds for inflated `$prev_pageview_duration` values (e.g., capping at 30 minutes) may want to review those after upgrading, as the root cause is now fixed.