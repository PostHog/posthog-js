---
'posthog-js': patch
---

fix: only append the `_` cache-buster query param to GET requests. It exists to bust browser caches for GETs, but our data-collection requests are POSTs (which browsers don't cache), so it's unnecessary there. Skipping it on POSTs simplifies the request URL.
