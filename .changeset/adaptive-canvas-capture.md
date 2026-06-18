---
'posthog-js': minor
'@posthog/rrweb': patch
---

feat(replay): experimental adaptive canvas capture

Adds an opt-in `session_recording.canvasCapture: { varyFps, varyQuality }` that adaptively reduces canvas capture fidelity as a session accumulates bytes, so heavy canvas recordings (animation/video) cost less without dropping data.

It's keyed on the per-session flushed-bytes counter, so it resets to the configured fidelity when a new session starts. Both levers are off by default and the steps are deliberately gentle (fps is only nudged down by one, e.g. 4 to 3, once a session crosses a byte threshold; quality is lowered slightly) since playback fidelity matters.

Mechanically, `@posthog/rrweb`'s canvas FPS-snapshot observer now reads its fps/quality from a live config so it can be retuned mid-session via `record.reconfigureCanvas({ fps, quality })`, rather than being fixed at record start.
