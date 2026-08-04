---
'posthog-js': patch
---

fix(replay): hold fresh interaction-less session recordings until there is evidence someone cares

A tab that loads but never sees any user interaction (prefetched pages, background tabs, in-app browser preloads) no longer ships a billable recording while it sits untouched. Like rotation-born sessions, a fresh recording epoch is held until there is evidence someone cares about it: a user interaction, an event trigger match, or an explicit override (`posthog.startSessionRecording(...)`) releases the hold and ships the buffer on the normal flush cadence, so released recordings are playable from the session's start. A clean unload also ships a fresh-start hold, so passive visits (reading, watching a video) are still captured exactly as before; rotation-born holds are discarded on unload as before. A held buffer that reaches the size cap is dropped to bound memory, and a later release takes a fresh full snapshot so the recording resumes playable.
