---
'posthog-js': minor
'@posthog/rrweb': minor
'@posthog/rrweb-types': minor
'@posthog/types': minor
---

Add canvas mask regions to session replay canvas capture. `session_recording.canvasCapture.maskRegionsFn` is called once per canvas per captured frame and the returned CSS-pixel regions are painted black in the captured frame before it is encoded — letting apps that render into canvas (e.g. Flutter web via CanvasKit) mask content that DOM-based masking cannot see. Return `[]` for a frame with nothing to mask, or `null` if regions could not be computed — a `null` frame is skipped rather than recorded unmasked. Configuring `maskRegionsFn` also disables canvas pixel serialization in DOM full snapshots (`rr_dataURL`) — that path never sees the mask regions, so skipping it closes the route that could otherwise embed unmasked canvas stills in a snapshot; the canvas repaints from the masked frame stream instead. An app whose real provider only exists once its runtime has booted chooses what happens in between by what it declares in `posthog.init`: a function covering the whole canvas blacks those frames out, `() => null` skips them, and declaring nothing records them. Masked canvases re-send an unchanged frame as a keyframe every 30s so seeking in the player has a frame from at most 30s earlier to repaint from. Client-side only; without the option canvas capture behavior is unchanged.
