---
'posthog-js': patch
---

Encode uncompressed `sendBeacon` bodies as base64 form data so the beacon keeps a CORS-simple content type. Previously an uncompressed unload beacon was sent as `application/json`, which forces a CORS preflight — a preflight cannot complete while the page unloads, so on cross-origin hosts the browser silently dropped the POST and the final batch of events was lost. Compression is inactive whenever the remote config request fails (flaky network, blocked endpoint), when the config response omits `supportedCompression`, or with `disable_compression: true`.
