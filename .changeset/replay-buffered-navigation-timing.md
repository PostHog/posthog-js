---
'posthog-js': patch
---

Capture the document navigation timing in the replay network waterfall when recording starts after the page has loaded, and stop recording a partial duplicate of that entry when recording starts while the page is still loading
