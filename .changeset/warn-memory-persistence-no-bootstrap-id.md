---
'posthog-js': patch
---

Warn at init when `persistence` is `'memory'` or `'sessionStorage'` and no `bootstrap.distinctID` is set. In this setup the SDK mints a fresh distinct ID on every page load, so each `identify()` call merges another ID onto the same person. A person can then pass the distinct-ID limit, after which person pages and the session tab load only a truncated slice and the rest of the events look missing even though ingestion is fine. The warning points at the two fixes: switch to `localStorage+cookie`, or keep this persistence and pass a stable ID through `bootstrap.distinctID`.
