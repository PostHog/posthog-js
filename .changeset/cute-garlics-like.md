---
'posthog-node': patch
---

Local evaluation polling sends If-None-Match header with latest etag to reduce bandwidth when no flags have changed.
