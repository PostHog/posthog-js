---
'posthog-js': patch
---

Fix event-triggered survey popup delays resetting on every page navigation. The popup delay now resumes from when the trigger fired (persisted for the session) instead of restarting a fresh countdown on each page load, so a survey configured with an event/action trigger and a popup delay no longer gets lost when the user navigates before the delay elapses.
