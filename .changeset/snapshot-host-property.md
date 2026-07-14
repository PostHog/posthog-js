---
'posthog-js': minor
---

Stamp the current hostname as `$snapshot_host` on every `$snapshot` event the session recorder sends. The value is derived from the page URL after it passes through the existing replay URL masking pipeline (`maskCapturedNetworkRequestFn` / deprecated `maskNetworkRequestFn`, hash stripping, personal-data query-param masking), so it cannot bypass a customer's masking config. When masking removes the URL or the masked result doesn't parse as a URL, the property is omitted entirely. This gives ingestion consumers a per-message host signal even for mid-session snapshot batches that contain no URL-bearing events.
