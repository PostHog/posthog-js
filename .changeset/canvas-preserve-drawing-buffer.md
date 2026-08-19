---
'posthog-js': patch
---

Fix WebGL canvases replaying blank when the page creates its rendering context while loading. A WebGL context created with `preserveDrawingBuffer: false` - the spec default, and what most renderers ask for - lets the browser discard the drawn pixels once the frame has been composited, so the frames replay captures come back empty. The recorder already forces the attribute on when it patches `getContext`, but it could only do that once the lazily loaded recorder bundle had arrived, and context attributes cannot be changed after creation - so any renderer that booted with the page had already created a context that could never be captured. That patch now also runs synchronously during `posthog.init()` whenever canvas recording is already known to be on: declaring `session_recording.captureCanvas.recordCanvas` covers the first page load, and enabling canvas recording in project settings alone covers every load after the one that persists the remote config.
