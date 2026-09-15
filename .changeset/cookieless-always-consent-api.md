---
'posthog-js': patch
---

Report `has_opted_out_capturing()` as `false` and `has_opted_in_capturing()` as `true` under `cookieless_mode: 'always'`. That mode always captures and ignores opt in and opt out, so it has no consent decision to report, and an application that gated its own capture calls on these dropped every event.
