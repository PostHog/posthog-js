---
'posthog-js': patch
---

Conversations: the widget now comes back after `reset()`, and after a cookieless (`on_reject`) visitor calls `opt_in_capturing()`, instead of staying unavailable until the next page load.
