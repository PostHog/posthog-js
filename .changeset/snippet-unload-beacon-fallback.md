---
'posthog-js': patch
---

feat: events sent via the sendBeacon transport to the events endpoint now carry `$sent_send_beacon: true`, and the reference snippet gains an unload fallback that beacons queued captures (marked `$sent_by_snippet_fallback_on_unload: true`) when the page unloads before array.js has loaded
