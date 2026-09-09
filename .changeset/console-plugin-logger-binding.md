---
'posthog-js': patch
---

Call the original console method with the console as its receiver when recording console logs. The wrapper passed `undefined` instead, and passed no receiver at all when reporting its own failures, which a console implementation is free to reject.
