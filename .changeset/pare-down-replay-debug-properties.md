---
'posthog-js': patch
---

Reduce replay debug properties on captured events while preserving recording status and capture diagnostics. Report cumulative mutation-drop counts and dropped bytes on `$snapshot` events only when greater than zero.
