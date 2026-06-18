---
'posthog-js': minor
'@posthog/rrweb': patch
---

feat(replay): experimental adaptive canvas capture

Adds an opt-in `session_recording.canvasCapture: { varyFps, varyQuality, varyResolution, thresholdsMb }` that adaptively reduces canvas capture cost as a session accumulates bytes, so heavy canvas recordings (animation/video) cost less without dropping data or breaking playback.

It's keyed on the per-session flushed-bytes counter, so it resets to the configured fidelity when a new session starts. All levers are off by default (and `varyResolution` defaults to `1`, matching today's production), and the steps are deliberately gentle since playback fidelity matters:

- `varyFps` only nudges fps down by one (e.g. 4 to 3) once a session crosses a byte threshold.
- `varyQuality` lowers the encode quality slightly per step.
- `varyResolution` is the highest-leverage lever: it downscales the captured bitmap (pixel-area savings are quadratic) while still recording the canvas's true display size, so playback stretches the smaller frame back to the correct dimensions and aspect ratio - only sharpness drops, never layout. Accepts a `boolean` (stepped ladder) or a fixed `number` scale.
- `thresholdsMb` configures the three increasing byte thresholds (validated and clamped) at which the levers step.

Mechanically, `@posthog/rrweb`'s canvas FPS-snapshot observer now reads its fps/quality/scale from a live config so it can be retuned mid-session via `record.reconfigureCanvas({ fps, quality, scale })`, rather than being fixed at record start. The captured display size is tracked on the main thread (not echoed from the encode worker) so downscaling can never mislabel a canvas's dimensions.
