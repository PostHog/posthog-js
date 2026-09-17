---
'posthog-js': minor
'@posthog/types': patch
---

Rename the default `metrics.network` histogram attributes to the OpenTelemetry semantic conventions: `method` is now `http.request.method`, `host` is `server.address`, `path` is `url.template`, and `status_class` is replaced by `http.response.status_code` and `error.type`. `url.scheme` is also recorded. If your `attributes` callback overrides `path`, return `url.template` instead.
