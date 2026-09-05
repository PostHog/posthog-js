---
'posthog-js': patch
---

Wait for the initial remote config outcome before using cached autocapture enablement, so a newly disabled project does not capture events while its settings load. Disabled remote requests retain local startup behavior, and failed or incomplete responses retain the cached fallback.
