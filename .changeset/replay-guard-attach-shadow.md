---
'posthog-js': patch
---

Fix session replay playback ending when a recording contains a shadow host the browser refuses. The player now skips that one subtree instead of aborting the rebuild.
