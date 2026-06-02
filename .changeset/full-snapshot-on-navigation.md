---
'posthog-js': minor
---

session replay: add opt-in `full_snapshot_on_navigation` that takes a fresh full snapshot on SPA navigation (`$pageview`). Prevents the replayed DOM from drifting across route changes on long, navigation-heavy single-page-app sessions. Configurable client-side via `session_recording.full_snapshot_on_navigation` or server-side per team. Off by default.
