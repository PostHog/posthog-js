---
'posthog-js': patch
---

Session replay no longer installs the network plugin when the client sets `session_recording.recordHeaders` and `recordBody` to `false` and turns network timing off, even if the project enables network payload capture. Previously request URLs and timings were still recorded.
