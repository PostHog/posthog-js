---
'posthog-js': patch
---

fix: remove redundant `ver` and gzip `compression` query params from capture requests. `$lib_version` is already included in the event payload, and gzip is self-describing via its magic-byte header, so neither is required for ingestion — dropping them simplifies the request URL. Non-gzip codecs (base64) still send the `compression` hint, which non-legacy endpoints such as session replay require.
