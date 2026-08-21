---
'@posthog/rrweb': patch
'@posthog/rrweb-snapshot': patch
---

Fix the session replay player aborting playback when a recording contains a shadow host the browser refuses. The player now skips that one subtree instead of letting `attachShadow` throw and kill the whole rebuild.
