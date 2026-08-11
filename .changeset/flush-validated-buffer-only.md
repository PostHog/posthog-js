---
'posthog-js': patch
---

fix(replay): never ship a buffer swapped in by a re-entrant session rotation mid-flush
