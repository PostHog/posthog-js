---
'posthog-js': patch
---

fix(replay): keep a held recording epoch's buffered data when it hits the size cap

A recording held until user interaction stopped collecting at the buffer size cap and also dropped everything already buffered, so a page that mutated heavily before the first interaction lost the start of its recording. The cap now only stops further collection; the held data survives and ships when the hold releases, and a fresh-start hold ships it on a clean unload like any other.
