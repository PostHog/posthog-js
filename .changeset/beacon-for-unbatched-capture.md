---
'posthog-js': patch
'@posthog/types': patch
---

Prefer `sendBeacon` for unbatched events, such as `{ send_instantly: true }` captures, once PostHog's own `pagehide` handler (or `unload` fallback) marks the page as unloading. Captures from `beforeunload` or earlier `pagehide` listeners retain their normal transport. Preserve response-capable transports on active pages so failed requests can be retried, including when `fetch` is unavailable.
