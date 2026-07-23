---
'posthog-js': patch
---

Send ISO feature flag timestamps in request bodies, use numeric `sent_at` query timestamps for capture POSTs, and preserve `_` cache busting for dynamic GET requests.
