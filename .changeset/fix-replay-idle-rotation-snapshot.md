---
'posthog-js': patch
---

fix(replay): take a fresh full snapshot after session ID rotates via `forcedIdleReset`. Previously, when the session manager's idle enforcement timer rotated the session id, the recorder tore down rrweb and set `_isIdle = 'unknown'` before the new session id was observed. Neither restart path then fired (the `_onSessionIdCallback` guard only restarted when `_isIdle === true`, and `_updateWindowAndSessionIds` could not run with rrweb stopped), so the new session received only incremental mutations until a later snapshot — leaving the player stuck on "Buffering". The restart guard now also fires when rrweb isn't running.
