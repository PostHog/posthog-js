---
'posthog-js': patch
'@posthog/types': patch
---

`capture_pageview: 'history_change'` now captures a `$pageview` when a single-page-app navigation changes the query string or the hash, not only the path. Before this change, navigation to search results, filters, pagination, and tab state captured no pageview, so these apps undercounted pageviews. `disable_capture_url_hashes` still suppresses hash-only changes. To keep the old behaviour, set `capture_pageview: { path: true }`.
