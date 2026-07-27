---
'@posthog/rrweb': patch
'posthog-js': patch
---

Fix paused replay seeks at an exact full snapshot timestamp so the snapshot frame is rebuilt before playback pauses.
