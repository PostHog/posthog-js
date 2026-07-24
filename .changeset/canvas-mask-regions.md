---
'posthog-js': minor
'@posthog/rrweb': minor
'@posthog/rrweb-types': minor
'@posthog/types': minor
---

Add canvas mask regions to session replay canvas capture. `session_recording.captureCanvas.canvasMaskRegionsFn` is called once per canvas per captured frame and the returned CSS-pixel regions are painted black inside the capture pipeline, before the frame is encoded — letting apps that render into canvas (e.g. Flutter web via CanvasKit) mask content that DOM-based masking cannot see. `captureCanvas.requireMaskProvider` fails closed: frames captured before a provider registers (or when it throws) are fully blacked out instead of recorded unmasked. Masked canvases re-send an unchanged frame as a keyframe every 30s so seeking in the player always has a recent frame to repaint from. Both options are client-side only; without them canvas capture behavior is unchanged.
