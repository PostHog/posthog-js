---
"posthog-js": patch
---

Session recording no longer crashes on startup when a CDN-loaded recorder chunk runs against an older bundled core. Calls into `SessionIdManager.on`/`onSessionId` are now guarded so a core without those methods degrades gracefully instead of throwing a `TypeError` during `start()`.
