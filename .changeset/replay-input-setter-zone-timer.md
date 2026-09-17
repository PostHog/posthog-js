---
'posthog-js': patch
---

Session replay no longer defers its input setter hooks on zone.js's patched `setTimeout`. In Angular apps each of those timers ended a zone task and triggered another change detection, so any component writing an input property on every cycle drove the tab into an endless loop at 100% CPU.
