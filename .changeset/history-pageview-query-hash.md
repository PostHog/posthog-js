---
'posthog-js': patch
---

fix: capture `$pageview` on query-string-only and hash-only SPA navigations when `capture_pageview: 'history_change'`

`HistoryAutocapture` previously compared only `location.pathname`, so `pushState`/`replaceState`/`popstate` navigations that changed only the query string or hash (common in query-param-driven and hash-routed apps) were silently dropped. The full URL (`pathname + search + hash`, respecting `disable_capture_url_hashes`) is now compared instead, matching how other analytics tools track history-based navigations.
