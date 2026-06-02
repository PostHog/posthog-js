---
'@posthog/rrweb': patch
---

canvas recording: reference-count CanvasManager teardown so it survives secondary-root cleanup. A single CanvasManager is shared by the main document and every iframe / shadow-root observer; previously tearing down any one of those (e.g. an iframe unloading, or a framework unmounting a subtree rrweb was observing) unpatched `HTMLCanvasElement.prototype.getContext` and cancelled the FPS loop for the whole page, silently stopping canvas recording while the session stayed active. The manager now only tears down once the last consumer releases.
