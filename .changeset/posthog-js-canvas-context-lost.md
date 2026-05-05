---
'posthog-js': patch
---

Pull in the canvas-manager fix from `@posthog/rrweb` 0.0.61: skip canvas
snapshots while the WebGL context is lost so transparent bitmaps don't
poison the worker's fingerprint dedup map and silently kill canvas
recording for the rest of the session. Also wraps `getCanvas()` in
try/catch so DOM/shadow-root traversal errors can't cancel the rAF
loop. See PR #3527 for context.
