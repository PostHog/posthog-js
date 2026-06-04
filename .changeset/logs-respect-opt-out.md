---
'posthog-js': patch
---

logs: the console-log integration now respects `opt_out_capturing()` — it checks `is_capturing()` before emitting, so log events stop on opt-out (and resume on opt-in).
