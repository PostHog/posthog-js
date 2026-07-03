---
"posthog-js": patch
---

Fix event-triggered surveys re-displaying in a fresh session without their trigger firing. A non-repeatable event/action-triggered survey that was shown but never dismissed or answered had its activation persisted indefinitely, so it kept being treated as "triggered" on later page loads. The persisted activation is now scoped to the triggering session: it still survives a reload within that session, but a brand-new session drops it until the trigger fires again. Repeatable surveys are unaffected.
