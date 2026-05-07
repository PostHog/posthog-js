---
'posthog-js': patch
---

fix: stop session recording before destroying sessionManager in `opt_out_capturing()` with `cookieless_mode: "on_reject"`. Previously, queued/throttled rrweb events (e.g. mousemove) could fire after the sessionManager was set to `undefined` and throw `[SessionRecording] must be started with a valid sessionManager`. Also adds a defensive early-return in `onRRwebEmit` so any remaining late events bail out instead of throwing.
