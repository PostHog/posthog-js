---
'posthog-js': patch
---

Conversations: a `reset()` or opt-out that happens while the widget is still loading its tickets (or a restore link) no longer brings the widget back, restarts polling, or writes the old ticket id back to storage.
