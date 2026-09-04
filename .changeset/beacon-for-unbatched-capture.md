---
'posthog-js': patch
'@posthog/types': patch
---

Send unbatched events, such as `{ send_instantly: true }` captures, with `sendBeacon` when `fetch` is not available or the page unloads, so a navigation cannot cancel them.
