---
'posthog-js': minor
'@posthog/types': minor
---

Add canvas mask regions to session replay canvas capture: `session_recording.canvasCapture.maskRegionsFn` is called once per canvas per captured frame, and the returned regions (CSS pixels, relative to the canvas) are painted black in the captured frame before it is encoded — letting apps that render into canvas (e.g. Flutter web via CanvasKit) mask content that DOM-based masking cannot see.

The return value decides what happens to that canvas's frame:

- `[]` — nothing to mask; the frame is recorded as is.
- `null` — regions could not be computed; the frame is skipped rather than recorded unmasked.
- `maskRegionsFn` not set — canvases are recorded unmasked and canvas capture behavior is unchanged.

Configuring `maskRegionsFn` also disables canvas pixel serialization in DOM full snapshots (`rr_dataURL`) — that path never sees the mask regions, so skipping it closes the route that could otherwise embed unmasked canvas stills in a snapshot; the canvas repaints from the masked frame stream instead. Every canvas the provider answers — with regions or `[]` — re-sends an unchanged frame as a keyframe every 30s, so after a full snapshot or a seek an idle canvas repaints within at most 30s.

An app whose real provider only exists once its runtime has booted chooses what happens in between by what it declares in `posthog.init`: a function covering the whole canvas blacks those frames out, `() => null` skips them, and declaring nothing records them. Client-side only, cannot be set via remote configuration.
