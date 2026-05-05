---
'@posthog/rrweb': patch
'@posthog/rrweb-record': patch
---

Skip canvas snapshot while WebGL context is lost. On mobile under GPU
pressure or tab backgrounding, `createImageBitmap` returns a transparent
bitmap rather than throwing for a context-lost WebGL canvas. The worker's
first-frame transparency check then suppresses emission and stores the
transparent fingerprint in `lastFingerprintMap`, so once the context
restores and three.js re-renders, identical-fingerprint frames get
deduped against the transparent baseline and the canvas appears to never
record. Pre-flight `gl.isContextLost()` and skip the snapshot while the
context is down. Also wrap the `getCanvas()` shadow-root walk in
try/catch so a traversal exception cannot cancel the rAF loop and
silently kill canvas recording for the rest of the session.
