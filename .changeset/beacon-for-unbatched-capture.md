---
'posthog-js': patch
'@posthog/types': patch
---

Prefer `sendBeacon` for unbatched events, such as `{ send_instantly: true }` captures, during page unload. Preserve response-capable transports on active pages so failed requests can be retried, including when `fetch` is unavailable.
