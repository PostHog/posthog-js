---
'posthog-js': patch
---

feat: events sent via the sendBeacon transport to the events endpoint now carry `$sent_send_beacon: true`. Also adds an opt-in snippet companion block (`packages/browser/snippet/unload-fallback.js`, not part of the default snippet) that beacons snippet-queued capture calls, marked `$sent_by_snippet_fallback_on_unload: true`, when the page unloads before array.js has loaded
