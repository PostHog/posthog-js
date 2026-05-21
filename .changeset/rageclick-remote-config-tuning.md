---
'posthog-js': minor
---

Accept rage click detector sensitivity (`threshold_px`, `timeout_ms`, `click_count`) from the `/array/{token}/config` remote config response and merge it onto the running detector. Per-field client config (`posthog.init({ rageclick: { ... } })`) takes precedence over remote values, and `posthog.init({ rageclick: false })` is never re-enabled by the server. Backend delivery of these tunables isn't shipped yet — this is the SDK-side wiring.
