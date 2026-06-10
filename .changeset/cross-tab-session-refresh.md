---
'posthog-js': patch
---

fix(sessionid): keep the session id stable across tabs

A session now rotates only when every tab has been idle past the timeout, rather than whenever a single background tab decides it is idle. On the active event path an idle tab re-reads the session id from storage before rotating: if a sibling tab kept the session alive it does not rotate, and if a sibling already rotated it adopts that id instead of minting a new one. This removes spurious cross-tab session fragmentation (inflated session counts, truncated session durations, split replays). When a sibling session is adopted, `onSessionId` handlers fire with `changeReason.crossTabAdoption: true` so session recording, pageview state, and session-scoped properties follow the new session. When `persistence_save_debounce_ms > 0` (the `2026-05-30` default) the refresh reads only the session-id key so it cannot clobber a sibling's write.

Note: projects with significant multi-tab usage will see fewer but longer sessions after upgrading — this is a correction of previously over-counted sessions, not a traffic change.
