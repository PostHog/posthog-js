---
'posthog-js': patch
---

`opt_out_capturing()` now drops events that were captured before opting out but not yet sent, instead of sending them later with the next batch or retry. To send an event right before opting out, capture it with `{ send_instantly: true }`. `cookieless_mode: 'on_reject'` is unchanged.
