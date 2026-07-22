---
'posthog-js': patch
---

Fix session replay recordings being unplayable after the session rotated in a tab with no user interaction. When a session expired and rotated (for example in a long-lived background tab), a recorder that had not yet seen user interaction kept attributing snapshots — including full snapshots — to the previous session, so the new session never received a playable full snapshot. The recorder now restarts on rotation in this state, re-syncs its session id from the session manager if they ever diverge, and flushes its buffer on the normal cadence before the first user interaction instead of holding data until the next rotation or page unload.
