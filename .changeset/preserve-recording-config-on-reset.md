---
'posthog-js': patch
---

Preserve session-recording remote config across `posthog.reset()`.

`posthog.reset()` was clearing the entire persistence store, which wiped
`$session_recording_remote_config` along with user state. On the next session
rotation triggered by the reset, `start('session_id_changed')` would early-return
because the remote config was missing — leaving rrweb torn down and the new
session opening with no Meta + FullSnapshot until the next periodic 5-minute
checkout.

This affected any flow where an app calls `posthog.reset()` mid-session
(e.g. on sign-out / sign-in) and was particularly visible on Flutter Web
recordings that depend on a fresh FullSnapshot to anchor the CanvasKit DOM.
