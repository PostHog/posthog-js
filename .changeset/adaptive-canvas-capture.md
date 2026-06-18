---
'posthog-js': minor
'@posthog/types': patch
'@posthog/rrweb': patch
---

feat(replay): capture canvas at reduced resolution

Adds `session_recording.canvasCapture.resolutionScale` - a `(0, 1]` fraction of the canvas display size to capture replay frames at. The captured bitmap is downscaled (pixel-area savings are quadratic) while the canvas's true display size is still recorded, so playback stretches the smaller frame back to the correct dimensions and aspect ratio - only sharpness drops, never layout. It defaults to `1` (full resolution, matching today's behaviour), and the latest `defaults` bundle (`2026-05-30`) opts new installs into `0.6`.

The canvas's true display size travels with each frame through the encode worker (as required message fields), so the encoded reply is always drawn back to the correct dimensions — no per-canvas state is retained on the main thread, and downscaling can never mislabel a canvas's dimensions. At full resolution the captured pixels are unchanged (the quality resampling hint is only applied when actually downscaling); the emitted `drawImage` now always uses the explicit destination-size form, which is pixel-equivalent on replay.

Mechanically, `@posthog/rrweb`'s canvas FPS-snapshot observer takes an optional `canvasResolutionScale` record option and downscales each captured frame accordingly.
