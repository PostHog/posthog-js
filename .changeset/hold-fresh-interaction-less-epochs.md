---
'posthog-js': patch
---

fix(replay): hold fresh interaction-less session recordings until user interaction

A tab that loads but never sees any user interaction (prefetched pages, background tabs, in-app browser preloads) no longer ships a billable recording. Like rotation-born sessions, a fresh recording epoch is now held until there is evidence someone cares about it: a user interaction, an event trigger match, or an explicit override (`posthog.startSessionRecording(...)`) releases the hold and ships the buffer, so released recordings are playable from the session's start. Without a release, the held data is discarded on rotation, stop, opt-out, or unload.
