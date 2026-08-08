---
'posthog-js': patch
---

Fix canvas session recordings rendering at the wrong size after a seek. The recorder now carries the canvas coordinate space (its `width`/`height` attributes) with each frame, and replay restores that size before drawing the frame. A seek and straight playback now render the same instant at the same scale, which fixes mis-scaled canvases on high-DPR screens and canvas-based apps (Flutter web, WebGL, drawing tools).
