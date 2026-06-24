---
'posthog-js': patch
---

Fix a `TypeError: Cannot read properties of null (reading 'toString')` thrown from log capture initialization when the session manager returns null session timestamps. `initializeLogs` now coerces the timestamps safely and never throws out of initialization.
