---
'posthog-js': minor
'@posthog/types': patch
---

Rename the `metrics.network` default attributes to the OTel HTTP client semantic conventions: `http.request.method`, `server.address`, `server.port`, `url.scheme`, `url.template`, `http.response.status_code` and `error.type` replace `method`, `host`, `path` and `status_class`.
