---
"@posthog/rrweb-types": patch
"@posthog/rrweb": patch
"posthog-js": patch
---

Capture native Fullscreen API transitions in session replay. Entering native fullscreen (`element.requestFullscreen()`) is rendered by the browser via the UA `:fullscreen` pseudo-class with no DOM mutation, so the recorder previously captured nothing and replays showed the element at its pre-fullscreen size with drifted click coordinates. The recorder now emits a reserved custom event on `fullscreenchange` (standard plus `webkit`/`moz`/`MS` prefixes), and the replayer re-applies fullscreen layout to the element on playback (including when scrubbing into a fullscreen region) via a reserved `rr_fullscreen` attribute, consistent with rrweb's existing `rr_*` attribute namespace.

Known limitation: fullscreen of an element inside a same-origin iframe is recorded against the `<iframe>` element rather than the inner element, so replay pins the iframe.
