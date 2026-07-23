---
'@posthog/rrweb': patch
---

Terminate the canvas encode worker when session recording stops. Previously stopping a recording with canvas capture enabled cancelled the capture loop but left the dedicated worker running; dedicated workers are not cleaned up by becoming unreachable, so every stop/start cycle leaked a worker thread along with its capture-resolution OffscreenCanvas (~8MB of pixel buffer at 1080p) and frame-fingerprint state.
