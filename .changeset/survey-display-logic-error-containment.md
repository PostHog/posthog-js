---
'posthog-js': patch
---

Report a failure in the survey display logic once instead of on every one-second tick, and stop the loop after repeated failures.
